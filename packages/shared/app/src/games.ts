import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type Database, gameMatches, users } from "@sidekick/db";
import {
  type CupPongState,
  type EightBallState,
  type GameActor,
  type GameType,
  cupPong,
  cupPongStateSchema,
  eightBall,
  eightBallStateSchema,
  gameTypeSchema,
} from "@sidekick/core";
import { localDate } from "./goals/dates";

/** Active matches idle longer than this are treated as expired on any read (plan 21). */
const EXPIRY_MS = 48 * 60 * 60 * 1000;
/** A completed match only surfaces to the agent for this long after it ends. */
const LAST_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Human name for a game type, shared by the context block and the reaction prompt. */
export function gameDisplayName(gameType: GameType): string {
  return gameType === "eight_ball" ? "8 ball" : "cup pong";
}

const HIGHLIGHT_PHRASES: Record<string, string> = {
  ran_3_plus: "ran 3+ in a row",
  scratched_on_8: "scratched on the 8",
  won_on_8_early_opponent: "opponent sank the 8 early",
  balls_back_x2: "made both, balls back",
  comeback_from_3_down: "came back from 3 down",
  clean_sweep: "clean sweep",
};

/** A stored highlight tag → the short phrase the agent reads (plan 21 §Agent integration). */
export function describeHighlight(tag: string): string {
  return HIGHLIGHT_PHRASES[tag] ?? tag.replace(/_/g, " ");
}

/** The active match, one line: whose move + a made-count standing per side. */
export type GamesActiveView = {
  gameType: GameType;
  toMove: GameActor;
  /** Cups/balls each side has put away — the "leads N to M" standing derives from this. */
  scores: { user: number; sidekick: number };
};

export type GameOutcome = "user_won" | "sidekick_won" | "user_resigned";

/** The last completed/resigned match, if it ended within the 24h window. */
export type GamesLastMatchView = {
  gameType: GameType;
  outcome: GameOutcome;
  completedAt: Date;
  /** Allowlisted highlight tags (empty for resigned matches — silence, not commentary). */
  highlights: string[];
};

export type GamesRecordEntry = { gameType: GameType; user: number; sidekick: number };

/** Everything `renderGamesBlock` needs — a pure snapshot, no DB handle. */
export type GamesContextView = {
  timezone: string;
  active: GamesActiveView | null;
  lastMatch: GamesLastMatchView | null;
  record: GamesRecordEntry[];
};

function cupScores(state: CupPongState): { user: number; sidekick: number } {
  return {
    user: 10 - cupPong.cupCount(state.cups.sidekick),
    sidekick: 10 - cupPong.cupCount(state.cups.user),
  };
}

function eightScores(state: EightBallState): { user: number; sidekick: number } {
  if (state.userGroup === null) {
    return { user: 0, sidekick: 0 };
  }
  let solids = 0;
  let stripes = 0;
  for (let id = 1; id <= 15; id++) {
    if (id === 8 || state.balls[id]?.pocketed) continue;
    const group = eightBall.groupOf(id);
    if (group === "solids") solids++;
    else if (group === "stripes") stripes++;
  }
  const userLeft = state.userGroup === "solids" ? solids : stripes;
  const sidekickLeft = state.userGroup === "solids" ? stripes : solids;
  return { user: 7 - userLeft, sidekick: 7 - sidekickLeft };
}

function activeView(gameType: GameType, rawState: unknown): GamesActiveView | null {
  if (gameType === "cup_pong") {
    const parsed = cupPongStateSchema.safeParse(rawState);
    if (!parsed.success) return null;
    return { gameType, toMove: parsed.data.toMove, scores: cupScores(parsed.data) };
  }
  const parsed = eightBallStateSchema.safeParse(rawState);
  if (!parsed.success) return null;
  return { gameType, toMove: parsed.data.toMove, scores: eightScores(parsed.data) };
}

function outcomeOf(status: string, winner: string | null): GameOutcome {
  if (status === "resigned") return "user_resigned";
  return winner === "user" ? "user_won" : "sidekick_won";
}

/**
 * The GAMES system block's data (plan 21 §Agent integration), queried the same
 * place deep-talk context is — inside `buildContextView` off `db`+`userId`. Cheap:
 * newest active match, newest completed/resigned match (24h window), and the
 * lifetime record aggregate. Returns null when the user has nothing worth saying
 * (never played, or only a stale/expired match) so the block is omitted entirely.
 * Read-only: a stale active match is skipped here, never written back.
 */
export async function gamesContext(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<GamesContextView | null> {
  const [userRows, activeRows, lastRows, recordRows] = await Promise.all([
    db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select()
      .from(gameMatches)
      .where(and(eq(gameMatches.userId, userId), eq(gameMatches.status, "active")))
      .orderBy(desc(gameMatches.updatedAt))
      .limit(1),
    db
      .select()
      .from(gameMatches)
      .where(and(eq(gameMatches.userId, userId), inArray(gameMatches.status, ["complete", "resigned"])))
      .orderBy(desc(gameMatches.completedAt))
      .limit(1),
    db
      .select({
        gameType: gameMatches.gameType,
        winner: gameMatches.winner,
        count: sql<number>`count(*)::int`,
      })
      .from(gameMatches)
      .where(and(eq(gameMatches.userId, userId), inArray(gameMatches.winner, ["user", "sidekick"])))
      .groupBy(gameMatches.gameType, gameMatches.winner),
  ]);

  const timezone = userRows[0]?.timezone ?? "UTC";

  let active: GamesActiveView | null = null;
  const activeRow = activeRows[0];
  if (activeRow && now.getTime() - activeRow.updatedAt.getTime() <= EXPIRY_MS) {
    const gameType = gameTypeSchema.safeParse(activeRow.gameType);
    if (gameType.success) active = activeView(gameType.data, activeRow.state);
  }

  let lastMatch: GamesLastMatchView | null = null;
  const lastRow = lastRows[0];
  if (
    lastRow?.completedAt &&
    now.getTime() - lastRow.completedAt.getTime() <= LAST_MATCH_WINDOW_MS
  ) {
    const gameType = gameTypeSchema.safeParse(lastRow.gameType);
    if (gameType.success) {
      const outcome = outcomeOf(lastRow.status, lastRow.winner);
      const highlights =
        outcome === "user_resigned" || !Array.isArray(lastRow.highlights)
          ? []
          : lastRow.highlights.filter((h): h is string => typeof h === "string");
      lastMatch = { gameType: gameType.data, outcome, completedAt: lastRow.completedAt, highlights };
    }
  }

  const totals = new Map<GameType, { user: number; sidekick: number }>();
  for (const row of recordRows) {
    const gameType = gameTypeSchema.safeParse(row.gameType);
    if (!gameType.success || (row.winner !== "user" && row.winner !== "sidekick")) continue;
    const entry = totals.get(gameType.data) ?? { user: 0, sidekick: 0 };
    entry[row.winner] = row.count;
    totals.set(gameType.data, entry);
  }
  const ORDER: GameType[] = ["eight_ball", "cup_pong"];
  const record: GamesRecordEntry[] = ORDER.filter((g) => totals.has(g)).map((gameType) => ({
    gameType,
    ...totals.get(gameType)!,
  }));

  if (!active && !lastMatch && record.length === 0) return null;
  return { timezone, active, lastMatch, record };
}
