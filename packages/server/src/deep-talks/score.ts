import { and, eq, sql } from "drizzle-orm";
import { type Database, memories, users } from "@sidekick/db";
import { type MemoryKind, computeContextScore, crossedBands } from "@sidekick/shared";
import { grantReward } from "../rewards/service";

/**
 * Coins granted the first time the context score enters each 25-point band
 * (14 §unlocks, wired through the `source:'event'` grant path). Plan 20
 * re-denominated this in coins: the sparks-era band cosmetics left with
 * `COSMETIC_CATALOG`, so the crossing pays through the ledger instead.
 */
export const CONTEXT_BAND_REWARD_COINS = 25;

/** Count active memories by kind for one user (the `n_k` of the score formula). */
export async function memoryCountsByKind(
  db: Database,
  userId: string,
): Promise<Partial<Record<MemoryKind, number>>> {
  const rows = await db
    .select({ kind: memories.kind, count: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")))
    .groupBy(memories.kind);
  const counts: Partial<Record<MemoryKind, number>> = {};
  for (const row of rows) {
    counts[row.kind] = Number(row.count);
  }
  return counts;
}

export type ScoreResult = {
  score: number;
  previous: number;
  /** Bands newly reached this recompute; each granted its one-time coin reward. */
  unlockedBands: number[];
};

/**
 * Recompute and persist the context score (14 §context score). Runs after every
 * extraction pass. The score is clamped to never fall below the stored value
 * (compaction folds memories into replacement sentences, so a lower raw count
 * must not drop the progress bar). Crossing a 25-point band grants its exclusive
 * coin reward through the idempotent grant path.
 */
export async function recomputeContextScore(db: Database, userId: string): Promise<ScoreResult> {
  const stored = await db
    .select({ contextScore: users.contextScore })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const previous = stored[0]?.contextScore ?? 0;

  const counts = await memoryCountsByKind(db, userId);
  const computed = computeContextScore(counts);
  const score = Math.max(previous, computed);

  if (score !== previous) {
    await db.update(users).set({ contextScore: score }).where(eq(users.id, userId));
  }

  const unlockedBands = crossedBands(previous, score);
  for (const band of unlockedBands) {
    await grantReward(db, {
      userId,
      source: "event",
      dedupeKey: `context-band:${band}`,
      outcome: { kind: "coins", amount: CONTEXT_BAND_REWARD_COINS },
    });
  }

  return { score, previous, unlockedBands };
}
