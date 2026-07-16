import { and, eq, sql } from "drizzle-orm";
import { type Database, memories, users } from "@sidekick/db";
import {
  CONTEXT_BANDS,
  type MemoryKind,
  computeContextScore,
  crossedBands,
  getCosmetic,
} from "@sidekick/shared";
import { grantReward } from "../rewards/service";

/**
 * The exclusive cosmetic granted the first time the context score enters each
 * 25-point band (14 §unlocks — "one exclusive cosmetic per 25-point band", wired
 * through 04's `source:'event'` grant path). Flavor only, never utility.
 */
const BAND_COSMETIC: Record<(typeof CONTEXT_BANDS)[number], string> = {
  25: "friendship-pin",
  50: "locket",
  75: "besties-charm",
  100: "soulmate-ring",
};

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
  /** Bands newly reached this recompute; each granted its exclusive cosmetic. */
  unlockedBands: number[];
};

/**
 * Recompute and persist the context score (14 §context score). Runs after every
 * extraction pass. The score is clamped to never fall below the stored value
 * (compaction folds memories into replacement sentences, so a lower raw count
 * must not drop the progress bar). Crossing a 25-point band grants its exclusive
 * cosmetic through the idempotent reward path.
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
    const itemKey = BAND_COSMETIC[band as (typeof CONTEXT_BANDS)[number]];
    const definition = getCosmetic(itemKey);
    if (definition) {
      await grantReward(db, {
        userId,
        source: "event",
        dedupeKey: `context-band:${band}`,
        outcome: { kind: "item", itemKey: definition.key, rarity: definition.rarity },
      });
    }
  }

  return { score, previous, unlockedBands };
}
