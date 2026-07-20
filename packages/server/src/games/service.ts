import { randomInt } from "node:crypto";
import type { LanguageModel } from "ai";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, conversations, gameMatches, ledger, messages, users } from "@sidekick/db";
import { localDate } from "@sidekick/shared";
import type { GameTurnInput } from "@sidekick/shared";
import {
  type CupPongFlick,
  type CupPongState,
  type EightBallShot,
  type EightBallState,
  type GameActor,
  type GameType,
  GAME_LOSS_COINS,
  GAME_REWARD_DAILY_CAP,
  GAME_WIN_COINS,
  cupPong,
  cupPongFlickSchema,
  cupPongStateSchema,
  eightBall,
  eightBallShotSchema,
  eightBallStateSchema,
  gameTypeSchema,
  mulberry32,
} from "@sidekick/core";
import { bumpStateVersion, grantReward } from "../rewards/service";
import { generateGameReaction } from "./reaction";

/** Active matches idle longer than this expire on the next read (plan 21). */
const EXPIRY_MS = 48 * 60 * 60 * 1000;

/**
 * The only engine event tags that surface as match highlights (plan 21 §Agent
 * integration) — genuinely notable moments; ordinary makes/misses never do.
 * Submitted `events` are filtered to this set and folded into the match.
 */
const HIGHLIGHT_ALLOWLIST = new Set([
  "ran_3_plus",
  "scratched_on_8",
  "won_on_8_early_opponent",
  "balls_back_x2",
  "comeback_from_3_down",
  "clean_sweep",
]);
const MAX_HIGHLIGHTS = 4;

export type GameSummary = {
  ballsLeft?: { user: number; sidekick: number };
  group?: "solids" | "stripes";
  cupsLeft?: { user: number; sidekick: number };
};

type GameState = EightBallState | CupPongState;
type MatchRow = typeof gameMatches.$inferSelect;

export type MatchView = {
  matchId: string;
  gameType: GameType;
  status: string;
  initiator: string;
  turnNo: number;
  winner: GameActor | null;
  highlights: string[];
  state: GameState;
};

export type TurnResult = MatchView & { stateVersion?: number; coins?: number };

/**
 * The `game` payload carried on every game turn card in the history join
 * (plan 21 §Card payload). `latest` marks the match's newest message row — only
 * it renders as the full interactive card; older rows collapse to a pill.
 */
export type GameCardView = {
  matchId: string;
  gameType: GameType;
  status: string;
  yourMove: boolean;
  winner: GameActor | null;
  latest: boolean;
  summary: GameSummary;
};

/**
 * A game engine as the router uses it: parse client jsonb against the exact core
 * schema for this game, run the deterministic sidekick turn, derive the card
 * summary. Generic over the game's State/Shot so `computeTurn` stays one shared
 * flow (plan 21 decision 3: one engine, the server runs the sidekick's turns).
 */
type Engine<S extends GameState, Shot> = {
  opening: (seed: number) => S;
  parseState: (raw: unknown) => S;
  parseShots: (raw: unknown) => Shot[];
  runSidekick: (state: S, rng: () => number) => S;
  withUserLastTurn: (state: S, shots: Shot[], pre: S) => S;
  summary: (state: S) => GameSummary;
};

/** rng for a sidekick turn: seeded from the match seed + that turn's number so
 * the reply is deterministic and an idempotent replay recomputes it identically. */
function sidekickRng(seed: number, turnNo: number): () => number {
  return mulberry32((seed + turnNo) >>> 0);
}

function eightBallSummary(state: EightBallState): GameSummary {
  let solids = 0;
  let stripes = 0;
  for (let id = 1; id <= 15; id++) {
    if (id === 8 || state.balls[id]?.pocketed) continue;
    const group = eightBall.groupOf(id);
    if (group === "solids") solids++;
    else if (group === "stripes") stripes++;
  }
  if (state.userGroup === null) {
    return { ballsLeft: { user: solids, sidekick: stripes } };
  }
  const user = state.userGroup === "solids" ? solids : stripes;
  const sidekick = state.userGroup === "solids" ? stripes : solids;
  return { ballsLeft: { user, sidekick }, group: state.userGroup };
}

function cupPongSummary(state: CupPongState): GameSummary {
  return {
    cupsLeft: {
      user: cupPong.cupCount(state.cups.user),
      sidekick: cupPong.cupCount(state.cups.sidekick),
    },
  };
}

const eightBallEngine: Engine<EightBallState, EightBallShot> = {
  opening: (seed) =>
    eightBall.runSidekickTurn(eightBall.initialRack(seed, "sidekick"), sidekickRng(seed, 1))
      .finalState,
  parseState: (raw) => eightBallStateSchema.parse(raw),
  parseShots: (raw) => z.array(eightBallShotSchema).parse(raw),
  runSidekick: (state, rng) => eightBall.runSidekickTurn(state, rng).finalState,
  withUserLastTurn: (state, shots, pre) => ({
    ...state,
    lastTurn: { actor: "user", shots, pre: eightBall.preTurnSnapshot(pre) },
  }),
  summary: eightBallSummary,
};

const cupPongEngine: Engine<CupPongState, CupPongFlick> = {
  opening: (seed) =>
    cupPong.runSidekickTurn(cupPong.initialState("sidekick"), sidekickRng(seed, 1)).finalState,
  parseState: (raw) => cupPongStateSchema.parse(raw),
  parseShots: (raw) => z.array(cupPongFlickSchema).parse(raw),
  runSidekick: (state, rng) => cupPong.runSidekickTurn(state, rng).finalState,
  withUserLastTurn: (state, shots, pre) => ({
    ...state,
    lastTurn: { actor: "user", shots, pre: cupPong.preTurnSnapshot(pre) },
  }),
  summary: cupPongSummary,
};

function parseState(gameType: GameType, raw: unknown): GameState {
  if (gameType === "eight_ball") return eightBallStateSchema.parse(raw);
  return cupPongStateSchema.parse(raw);
}

function stateSummary(gameType: GameType, state: GameState): GameSummary {
  if (gameType === "eight_ball") return eightBallSummary(eightBallStateSchema.parse(state));
  return cupPongSummary(cupPongStateSchema.parse(state));
}

function asWinner(value: string | null): GameActor | null {
  return value === "user" || value === "sidekick" ? value : null;
}

function parseHighlights(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string");
}

function toView(row: MatchRow): MatchView {
  const gameType = gameTypeSchema.parse(row.gameType);
  return {
    matchId: row.id,
    gameType,
    status: row.status,
    initiator: row.initiator,
    turnNo: row.turnNo,
    winner: asWinner(row.winner),
    highlights: parseHighlights(row.highlights),
    state: parseState(gameType, row.state),
  };
}

/** Flip an active match idle > 48h to expired, returning the up-to-date row. */
async function expireIfStale(db: Database, row: MatchRow, now: Date): Promise<MatchRow> {
  if (row.status !== "active") return row;
  if (now.getTime() - row.updatedAt.getTime() <= EXPIRY_MS) return row;
  const updated = await db
    .update(gameMatches)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(gameMatches.id, row.id), eq(gameMatches.status, "active")))
    .returning();
  return updated[0] ?? { ...row, status: "expired" };
}

async function ownedMatch(db: Database, userId: string, matchId: string): Promise<MatchRow> {
  const rows = await db
    .select()
    .from(gameMatches)
    .where(and(eq(gameMatches.id, matchId), eq(gameMatches.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "match not found" });
  }
  return row;
}

async function mainConversationId(db: Database, userId: string): Promise<string> {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.kind, "main")))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(conversations)
    .values({ userId, kind: "main" })
    .returning({ id: conversations.id });
  const id = inserted[0]?.id;
  if (!id) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "no conversation" });
  }
  return id;
}

/** Insert a turn card message: empty content, keyed to the match (plan 21). */
async function insertTurnCard(
  db: Database,
  conversationId: string,
  role: "user" | "assistant",
  matchId: string,
): Promise<void> {
  await db.insert(messages).values({
    conversationId,
    role,
    content: "",
    tokenEstimate: 0,
    gameMatchId: matchId,
  });
}

/**
 * Start a match (plan 21 §Server). Guard: an existing active match of this type
 * resumes rather than forks (tapping "8 Ball" twice never doubles up); a stale
 * one expires first. Otherwise create it (initiator 'user', sidekick to move —
 * the recipient breaks), run the sidekick's break server-side, and insert its
 * turn card, all in one transaction. No LLM call — the user is about to play.
 */
export async function createMatch(
  db: Database,
  userId: string,
  gameType: GameType,
  now = new Date(),
): Promise<MatchView> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(gameMatches)
      .where(
        and(
          eq(gameMatches.userId, userId),
          eq(gameMatches.gameType, gameType),
          eq(gameMatches.status, "active"),
        ),
      )
      .orderBy(desc(gameMatches.createdAt))
      .limit(1);
    const active = existing[0];
    if (active) {
      const fresh = await expireIfStale(tx, active, now);
      if (fresh.status === "active") return toView(fresh);
    }

    const conversationId = await mainConversationId(tx, userId);
    const seed = randomInt(2 ** 31);
    const engine = gameType === "eight_ball" ? eightBallEngine : cupPongEngine;
    const opening = engine.opening(seed);
    const winner = opening.winner;

    const insertedMatch = await tx
      .insert(gameMatches)
      .values({
        userId,
        conversationId,
        gameType,
        initiator: "user",
        status: winner === null ? "active" : "complete",
        state: opening,
        turnNo: 1,
        seed,
        winner,
        completedAt: winner === null ? null : now,
      })
      .returning();
    const match = insertedMatch[0];
    if (!match) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "failed to create match" });
    }

    await insertTurnCard(tx, conversationId, "assistant", match.id);
    return toView(match);
  });
}

/** The full match for opening the overlay (state carries `lastTurn` for replay). */
export async function getMatch(
  db: Database,
  userId: string,
  matchId: string,
  now = new Date(),
): Promise<MatchView> {
  const row = await ownedMatch(db, userId, matchId);
  return toView(await expireIfStale(db, row, now));
}

/** Lifetime record per game type — `count(*) group by winner`, no stats table. */
export async function gameRecord(
  db: Database,
  userId: string,
): Promise<Record<GameType, { user: number; sidekick: number }>> {
  const rows = await db
    .select({
      gameType: gameMatches.gameType,
      winner: gameMatches.winner,
      count: sql<number>`count(*)::int`,
    })
    .from(gameMatches)
    .where(and(eq(gameMatches.userId, userId), inArray(gameMatches.winner, ["user", "sidekick"])))
    .groupBy(gameMatches.gameType, gameMatches.winner);
  const record: Record<GameType, { user: number; sidekick: number }> = {
    eight_ball: { user: 0, sidekick: 0 },
    cup_pong: { user: 0, sidekick: 0 },
  };
  for (const row of rows) {
    const parsed = gameTypeSchema.safeParse(row.gameType);
    const winner = asWinner(row.winner);
    if (!parsed.success || !winner) continue;
    record[parsed.data][winner] = row.count;
  }
  return record;
}

type TurnPlan = {
  finalState: GameState;
  finalTurnNo: number;
  winner: GameActor | null;
  events: string[];
};

/**
 * The pure state transition for a submitted user turn: fold in the user's shots
 * (stamping `lastTurn` with the stored pre-turn state so the turn replays), and
 * — if the match isn't over — run the sidekick's reply with the same
 * deterministic engine, seeded from the match seed + the reply's turn number.
 */
function computeTurn<S extends GameState, Shot>(
  engine: Engine<S, Shot>,
  input: GameTurnInput,
  seed: number,
  storedState: unknown,
): TurnPlan {
  const userState = engine.withUserLastTurn(
    engine.parseState(input.state),
    engine.parseShots(input.shots),
    engine.parseState(storedState),
  );
  if (userState.winner !== null) {
    return {
      finalState: userState,
      finalTurnNo: input.turnNo,
      winner: userState.winner,
      events: input.events,
    };
  }
  const sidekickTurnNo = input.turnNo + 1;
  const sidekickState = engine.runSidekick(userState, sidekickRng(seed, sidekickTurnNo));
  return {
    finalState: sidekickState,
    finalTurnNo: sidekickTurnNo,
    winner: sidekickState.winner,
    events: input.events,
  };
}

function foldHighlights(existing: string[], events: string[]): string[] {
  const merged = [...existing];
  for (const event of events) {
    if (HIGHLIGHT_ALLOWLIST.has(event) && !merged.includes(event)) merged.push(event);
  }
  return merged.slice(0, MAX_HIGHLIGHTS);
}

/** Count the user's `game:*` ledger grants on their local day (the reward cap). */
async function gameGrantsToday(
  db: Database,
  userId: string,
  timezone: string,
  now: Date,
): Promise<number> {
  const today = localDate(timezone, now);
  const rows = await db
    .select({ createdAt: ledger.createdAt })
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.source, "game")));
  return rows.filter((row) => localDate(timezone, row.createdAt) === today).length;
}

async function currentCoins(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ coins: users.coins })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return row.coins;
}

/**
 * Grant the user's match reward through the ledger — 20 coins for a win, 5 for a
 * loss (flat, participation-flavored) — but only for the first
 * `GAME_REWARD_DAILY_CAP` completed matches on the user's local day. dedupe
 * `game:<matchId>` makes it idempotent; later matches grant 0 (just bump the
 * version so the snapshot still refreshes).
 */
async function grantMatchReward(
  db: Database,
  userId: string,
  matchId: string,
  winner: GameActor,
  timezone: string,
  now: Date,
): Promise<{ stateVersion: number; coins: number }> {
  if ((await gameGrantsToday(db, userId, timezone, now)) >= GAME_REWARD_DAILY_CAP) {
    const stateVersion = await bumpStateVersion(db, userId);
    return { stateVersion, coins: await currentCoins(db, userId) };
  }
  const grant = await grantReward(db, {
    userId,
    source: "game",
    dedupeKey: `game:${matchId}`,
    outcome: { kind: "coins", amount: winner === "user" ? GAME_WIN_COINS : GAME_LOSS_COINS },
  });
  return { stateVersion: grant.stateVersion, coins: grant.coins };
}

/**
 * Apply the user's completed turn (plan 21 §Server). Guards: match active, its
 * move is the user's, `turnNo` exactly current+1. Replaying the already-applied
 * turnNo returns the stored result without repeating any side effect; a stale or
 * out-of-order turnNo rejects. Inserts the user's card, computes and stores the
 * sidekick's deterministic reply (+ its card) when the match continues, and runs
 * completion (ledger grant, version bump, reaction) when either half ends it.
 */
export async function playTurn(
  db: Database,
  userId: string,
  input: GameTurnInput,
  model: LanguageModel,
  now = new Date(),
): Promise<TurnResult> {
  const outcome = await db.transaction(async (tx) => {
    const stale = await ownedMatch(tx, userId, input.matchId);
    const match = await expireIfStale(tx, stale, now);
    const gameType = gameTypeSchema.parse(match.gameType);
    const stored = parseState(gameType, match.state);

    const lastActor = stored.lastTurn?.actor ?? null;
    const appliedUserTurnNo = lastActor === "user" ? match.turnNo : match.turnNo - 1;
    if (input.turnNo === appliedUserTurnNo && input.turnNo >= 1) {
      return { view: toView(match), completed: false as const };
    }

    if (match.status !== "active") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "match is not active" });
    }
    if (stored.toMove !== "user") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "not your move" });
    }
    if (input.turnNo !== match.turnNo + 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "unexpected turn number" });
    }

    const plan =
      gameType === "eight_ball"
        ? computeTurn(eightBallEngine, input, match.seed, match.state)
        : computeTurn(cupPongEngine, input, match.seed, match.state);
    const highlights = foldHighlights(parseHighlights(match.highlights), plan.events);
    const conversationId = match.conversationId;

    await insertTurnCard(tx, conversationId, "user", match.id);
    const sidekickReplied = plan.finalTurnNo > input.turnNo;
    if (sidekickReplied) {
      await insertTurnCard(tx, conversationId, "assistant", match.id);
    }

    const completed = plan.winner !== null;
    const updated = await tx
      .update(gameMatches)
      .set({
        state: plan.finalState,
        turnNo: plan.finalTurnNo,
        highlights,
        winner: plan.winner,
        status: completed ? "complete" : "active",
        completedAt: completed ? now : null,
        updatedAt: now,
      })
      .where(eq(gameMatches.id, match.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "match update lost" });
    }

    if (!completed || plan.winner === null) {
      return { view: toView(row), completed: false as const };
    }
    const timezone = await userTimezone(tx, userId);
    const reward = await grantMatchReward(tx, userId, match.id, plan.winner, timezone, now);
    return {
      view: toView(row),
      completed: true as const,
      reward,
      winner: plan.winner,
      gameType,
      conversationId,
      standing: finalStanding(gameType, plan.finalState, plan.winner),
      highlights,
    };
  });

  if (outcome.completed) {
    await safeReaction(db, model, {
      conversationId: outcome.conversationId,
      gameType: outcome.gameType,
      winner: outcome.winner,
      standing: outcome.standing,
      highlights: outcome.highlights,
    });
    return { ...outcome.view, stateVersion: outcome.reward.stateVersion, coins: outcome.reward.coins };
  }
  return outcome.view;
}

/**
 * The winner-first final tally for the reaction's factual line (plan 21) — cups
 * or balls each side put away. Empty when it can't be read cleanly (e.g. an early
 * 8 before groups were assigned); the reaction line just omits the score then.
 */
function finalStanding(gameType: GameType, state: GameState, winner: GameActor): string {
  const summary = stateSummary(gameType, state);
  if (summary.cupsLeft) {
    const userMade = 10 - summary.cupsLeft.sidekick;
    const sidekickMade = 10 - summary.cupsLeft.user;
    return winner === "user" ? `${userMade}–${sidekickMade}` : `${sidekickMade}–${userMade}`;
  }
  if (summary.ballsLeft && summary.group) {
    const userMade = 7 - summary.ballsLeft.user;
    const sidekickMade = 7 - summary.ballsLeft.sidekick;
    return winner === "user" ? `${userMade}–${sidekickMade}` : `${sidekickMade}–${userMade}`;
  }
  return "";
}

async function userTimezone(db: Database, userId: string): Promise<string> {
  const rows = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return row.timezone;
}

/** Reaction generation is best-effort — it never fails the committed turn. */
async function safeReaction(
  db: Database,
  model: LanguageModel,
  input: Parameters<typeof generateGameReaction>[2],
): Promise<void> {
  try {
    await generateGameReaction(db, model, input);
  } catch {
    // A failed reaction must not surface to the client (reward + state commit first).
  }
}

/**
 * Resign an active match (plan 21 §Server): the sidekick wins, no coins, no
 * reaction, no message row — a resigned game gets silence.
 */
export async function resignMatch(
  db: Database,
  userId: string,
  matchId: string,
  now = new Date(),
): Promise<MatchView> {
  const row = await ownedMatch(db, userId, matchId);
  if (row.status !== "active") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "match is not active" });
  }
  const updated = await db
    .update(gameMatches)
    .set({ status: "resigned", winner: "sidekick", completedAt: now, updatedAt: now })
    .where(and(eq(gameMatches.id, matchId), eq(gameMatches.status, "active")))
    .returning();
  const resigned = updated[0] ?? { ...row, status: "resigned", winner: "sidekick" };
  return toView(resigned);
}

/**
 * The `game` card payload for a page of message rows (plan 21 §Card payload),
 * keyed by message id for the history join. Touches lazy expiry on any active
 * match it renders, and marks each match's newest message row as `latest`.
 */
export async function gamesForMessages<T extends { id: number; gameMatchId: string | null }>(
  db: Database,
  rows: T[],
  now = new Date(),
): Promise<Map<number, GameCardView>> {
  const matchIds = [...new Set(rows.map((r) => r.gameMatchId).filter((id): id is string => !!id))];
  if (matchIds.length === 0) return new Map();

  const matchRows = await db.select().from(gameMatches).where(inArray(gameMatches.id, matchIds));
  const byMatch = new Map<string, MatchRow>();
  for (const row of matchRows) {
    byMatch.set(row.id, await expireIfStale(db, row, now));
  }

  const latestRows = await db
    .select({ matchId: messages.gameMatchId, latestId: sql<string>`max(${messages.id})` })
    .from(messages)
    .where(inArray(messages.gameMatchId, matchIds))
    .groupBy(messages.gameMatchId);
  const latestByMatch = new Map<string, number>();
  for (const row of latestRows) {
    if (row.matchId) latestByMatch.set(row.matchId, Number(row.latestId));
  }

  const byMessage = new Map<number, GameCardView>();
  for (const row of rows) {
    if (!row.gameMatchId) continue;
    const match = byMatch.get(row.gameMatchId);
    if (!match) continue;
    const gameType = gameTypeSchema.parse(match.gameType);
    const state = parseState(gameType, match.state);
    byMessage.set(row.id, {
      matchId: match.id,
      gameType,
      status: match.status,
      yourMove: match.status === "active" && state.toMove === "user",
      winner: asWinner(match.winner),
      latest: latestByMatch.get(match.id) === row.id,
      summary: stateSummary(gameType, state),
    });
  }
  return byMessage;
}
