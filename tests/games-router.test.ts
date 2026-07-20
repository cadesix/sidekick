import { afterAll, beforeAll, expect, test } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { type Database, gameMatches, ledger, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  type CupPongState,
  type EightBallState,
  GAME_LOSS_COINS,
  GAME_REWARD_DAILY_CAP,
  GAME_WIN_COINS,
  cupPong,
  eightBall,
} from "@sidekick/core";
import { createConversation, createUser, makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function caller(userId: string) {
  return makeCaller(db, textModel("ok"), userId);
}

const CUP_FLICK = { x: 0, power: 0.5 };

/** A cup-pong state where the user's turn passed to the sidekick, game live. */
function cupTurnPassed(): CupPongState {
  return cupPong.initialState("sidekick");
}

/** A cup-pong state where the user just cleared the sidekick's last cups. */
function cupUserWon(): CupPongState {
  return { ...cupPong.initialState("sidekick"), cups: { user: cupPong.ALL_CUPS, sidekick: 0 }, winner: "user" };
}

/** An 8-ball state where the user's turn passed to the sidekick, game live. */
function eightTurnPassed(): EightBallState {
  return eightBall.initialRack(4242, "sidekick");
}

async function turnCards(matchId: string) {
  return db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.gameMatchId, matchId))
    .orderBy(asc(messages.id));
}

async function gameLedger(userId: string) {
  return db.select().from(ledger).where(and(eq(ledger.userId, userId), eq(ledger.source, "game")));
}

test("create: the sidekick breaks first, so the returned state is the user's move", async () => {
  const userId = await createUser(db);
  const match = await caller(userId).games.create({ gameType: "cup_pong" });

  expect(match.status).toBe("active");
  expect(match.initiator).toBe("user");
  expect(match.turnNo).toBe(1);
  expect(match.state.toMove).toBe("user");
  // the sidekick's break turn is recorded for the client to replay
  expect(match.state.lastTurn?.actor).toBe("sidekick");

  const cards = await turnCards(match.matchId);
  expect(cards).toHaveLength(1);
  expect(cards[0]!.role).toBe("assistant");
  expect(cards[0]!.content).toBe("");
});

test("create: a second create of the same type resumes the active match, never forks", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const first = await c.games.create({ gameType: "eight_ball" });
  const second = await c.games.create({ gameType: "eight_ball" });
  expect(second.matchId).toBe(first.matchId);

  const rows = await db
    .select()
    .from(gameMatches)
    .where(and(eq(gameMatches.userId, userId), eq(gameMatches.gameType, "eight_ball")));
  expect(rows).toHaveLength(1);
});

test("turn: a non-terminal turn inserts both cards and applies the sidekick's reply", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });

  const result = await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK, CUP_FLICK],
    state: cupTurnPassed(),
    events: [],
  });
  expect(result.turnNo).toBe(3);
  expect(result.state.toMove).toBe("user");
  expect(result.state.lastTurn?.actor).toBe("sidekick");
  expect(result.coins).toBeUndefined();

  const cards = await turnCards(match.matchId);
  expect(cards.map((c2) => c2.role)).toEqual(["assistant", "user", "assistant"]);
});

test("turn: replaying the same turnNo returns the stored result with no double side effects", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });

  const first = await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK],
    state: cupTurnPassed(),
    events: [],
  });
  const replay = await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK],
    state: cupTurnPassed(),
    events: [],
  });
  expect(replay).toEqual(first);

  // exactly the three cards from the first application — no extra rows
  const cards = await turnCards(match.matchId);
  expect(cards).toHaveLength(3);
});

test("turn: a stale or out-of-order turnNo is rejected", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });
  await c.games.turn({ matchId: match.matchId, turnNo: 2, shots: [CUP_FLICK], state: cupTurnPassed(), events: [] });

  // turnNo is now 3 (sidekick replied); the next user turn must be 4
  await expect(
    c.games.turn({ matchId: match.matchId, turnNo: 5, shots: [CUP_FLICK], state: cupTurnPassed(), events: [] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    c.games.turn({ matchId: match.matchId, turnNo: 1, shots: [CUP_FLICK], state: cupTurnPassed(), events: [] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("turn: rejected once the match is no longer active", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });
  await c.games.turn({ matchId: match.matchId, turnNo: 2, shots: [CUP_FLICK], state: cupUserWon(), events: [] });

  await expect(
    c.games.turn({ matchId: match.matchId, turnNo: 3, shots: [CUP_FLICK], state: cupTurnPassed(), events: [] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("turn: sidekick reply is deterministic from the match seed", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const c = caller(userId);
  const seed = 987654;

  const insert = async () => {
    const rows = await db
      .insert(gameMatches)
      .values({
        userId,
        conversationId,
        gameType: "cup_pong",
        initiator: "user",
        status: "active",
        state: cupPong.initialState("user"),
        turnNo: 1,
        seed,
      })
      .returning({ id: gameMatches.id });
    return rows[0]!.id;
  };

  const a = await c.games.turn({ matchId: await insert(), turnNo: 2, shots: [CUP_FLICK], state: cupTurnPassed(), events: [] });
  const b = await c.games.turn({ matchId: await insert(), turnNo: 2, shots: [CUP_FLICK], state: cupTurnPassed(), events: [] });
  expect(a.state).toEqual(b.state);
  expect(a.turnNo).toBe(b.turnNo);
});

test("turn: winning completes the match, grants coins via the ledger, and bumps the version", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });

  const result = await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK],
    state: cupUserWon(),
    events: [],
  });
  expect(result.status).toBe("complete");
  expect(result.winner).toBe("user");
  expect(result.coins).toBe(GAME_WIN_COINS);
  expect(result.stateVersion).toBeGreaterThan(0);

  const rows = await gameLedger(userId);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.dedupeKey).toBe(`game:${match.matchId}`);
  expect(rows[0]!.coins).toBe(GAME_WIN_COINS);

  // no sidekick card on a user-terminal turn — just create's card + the user's
  const cards = await turnCards(match.matchId);
  expect(cards.map((c2) => c2.role)).toEqual(["assistant", "user"]);
});

test("turn: a loss still pays the flat participation coins", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });
  const result = await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK],
    state: { ...cupPong.initialState("user"), cups: { user: 0, sidekick: cupPong.ALL_CUPS }, winner: "sidekick" },
    events: [],
  });
  expect(result.winner).toBe("sidekick");
  expect(result.coins).toBe(GAME_LOSS_COINS);
});

test("completion: only the first N matches per local day pay out", async () => {
  const userId = await createUser(db);
  const c = caller(userId);

  const coins: number[] = [];
  for (let i = 0; i < GAME_REWARD_DAILY_CAP + 1; i++) {
    const match = await c.games.create({ gameType: "cup_pong" });
    const result = await c.games.turn({
      matchId: match.matchId,
      turnNo: 2,
      shots: [CUP_FLICK],
      state: cupUserWon(),
      events: [],
    });
    coins.push(result.coins ?? -1);
  }

  const paid = coins.slice(0, GAME_REWARD_DAILY_CAP);
  expect(paid.every((c2) => c2 > 0)).toBe(true);
  // the capped match pays nothing — its coin balance equals the prior one
  expect(coins[GAME_REWARD_DAILY_CAP]).toBe(coins[GAME_REWARD_DAILY_CAP - 1]);

  const rows = await gameLedger(userId);
  expect(rows).toHaveLength(GAME_REWARD_DAILY_CAP);
});

test("resign: sidekick wins, no coins, no reaction message", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "eight_ball" });

  const result = await c.games.resign({ matchId: match.matchId });
  expect(result.status).toBe("resigned");
  expect(result.winner).toBe("sidekick");

  const rows = await gameLedger(userId);
  expect(rows).toHaveLength(0);
  // only the sidekick's break card exists — resign inserts no row
  const cards = await turnCards(match.matchId);
  expect(cards).toHaveLength(1);

  await expect(c.games.resign({ matchId: match.matchId })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});

test("lazy expiry: an active match idle past 48h flips to expired on read", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });

  const old = new Date(Date.now() - 49 * 60 * 60 * 1000);
  await db.update(gameMatches).set({ updatedAt: old }).where(eq(gameMatches.id, match.matchId));

  const fetched = await c.games.get({ matchId: match.matchId });
  expect(fetched.status).toBe("expired");
  expect(fetched.winner).toBeNull();
});

test("highlights: only allowlisted event tags are folded in, capped at four", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "cup_pong" });

  await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK],
    state: cupTurnPassed(),
    events: [
      "ran_3_plus",
      "miss",
      "cup:3",
      "scratched_on_8",
      "clean_sweep",
      "comeback_from_3_down",
      "balls_back_x2",
    ],
  });

  const fetched = await c.games.get({ matchId: match.matchId });
  expect(fetched.highlights).toEqual([
    "ran_3_plus",
    "scratched_on_8",
    "clean_sweep",
    "comeback_from_3_down",
  ]);
});

test("record: counts wins per game type, ignoring in-progress matches", async () => {
  const userId = await createUser(db);
  const c = caller(userId);

  const cup = await c.games.create({ gameType: "cup_pong" });
  await c.games.turn({ matchId: cup.matchId, turnNo: 2, shots: [CUP_FLICK], state: cupUserWon(), events: [] });
  const pool = await c.games.create({ gameType: "eight_ball" });
  await c.games.resign({ matchId: pool.matchId });
  // an active match doesn't count
  await c.games.create({ gameType: "eight_ball" });

  const record = await c.games.record();
  expect(record.cup_pong).toEqual({ user: 1, sidekick: 0 });
  expect(record.eight_ball).toEqual({ user: 0, sidekick: 1 });
});

test("ownership: another user cannot read or act on a match", async () => {
  const owner = await createUser(db);
  const intruder = await createUser(db);
  const match = await caller(owner).games.create({ gameType: "cup_pong" });

  await expect(caller(intruder).games.get({ matchId: match.matchId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    caller(intruder).games.turn({ matchId: match.matchId, turnNo: 2, shots: [CUP_FLICK], state: cupTurnPassed(), events: [] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("turn: 8-ball validates the submitted state against its own schema", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const match = await c.games.create({ gameType: "eight_ball" });

  const result = await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [{ dirX: 0, dirY: 1, power: 0.5, spin: { x: 0, y: 0 }, cuePlace: null }],
    state: eightTurnPassed(),
    events: [],
  });
  expect(result.turnNo).toBe(3);
  expect(result.state.toMove).toBe("user");
});
