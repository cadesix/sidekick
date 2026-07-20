import { afterAll, beforeAll, expect, test } from "vitest";
import { type Database, rateLimits } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { consumeRateLimit, pruneRateLimits, type RateLimit } from "@sidekick/server";

let db: Database;
let close: () => Promise<void>;

const limit: RateLimit = { points: 3, windowMs: 60_000 };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("a key is allowed up to its points and refused after", async () => {
  const at = new Date("2026-07-20T10:00:00Z");
  const results = [];
  for (let i = 0; i < 5; i += 1) {
    results.push(await consumeRateLimit(db, "allow:a", limit, at));
  }
  expect(results).toEqual([true, true, true, false, false]);
});

test("keys are counted independently", async () => {
  const at = new Date("2026-07-20T10:00:00Z");
  await consumeRateLimit(db, "independent:a", limit, at);
  await consumeRateLimit(db, "independent:a", limit, at);
  await consumeRateLimit(db, "independent:a", limit, at);
  expect(await consumeRateLimit(db, "independent:a", limit, at)).toBe(false);
  expect(await consumeRateLimit(db, "independent:b", limit, at)).toBe(true);
});

test("the counter resets when the window rolls over", async () => {
  const first = new Date("2026-07-20T11:00:00Z");
  for (let i = 0; i < 3; i += 1) {
    await consumeRateLimit(db, "rollover:a", limit, first);
  }
  expect(await consumeRateLimit(db, "rollover:a", limit, first)).toBe(false);

  const next = new Date(first.getTime() + limit.windowMs);
  expect(await consumeRateLimit(db, "rollover:a", limit, next)).toBe(true);
});

/**
 * The point of moving off the in-memory limiter: two callers that share nothing
 * but the database must still share the count. Concurrent consumes prove the
 * upsert is atomic — a read-then-write would let both see the same stale count.
 */
test("concurrent consumers share one durable count", async () => {
  const at = new Date("2026-07-20T12:00:00Z");
  const outcomes = await Promise.all(
    Array.from({ length: 10 }, () => consumeRateLimit(db, "concurrent:a", limit, at)),
  );
  expect(outcomes.filter(Boolean)).toHaveLength(limit.points);
});

test("pruning drops closed windows and leaves live ones alone", async () => {
  const old = new Date("2026-07-19T00:00:00Z");
  const now = new Date("2026-07-20T13:00:00Z");
  await consumeRateLimit(db, "prune:stale", limit, old);
  await consumeRateLimit(db, "prune:live", limit, now);

  await pruneRateLimits(db, now);

  const remaining = await db.select({ key: rateLimits.key }).from(rateLimits);
  const keys = remaining.map((row) => row.key);
  expect(keys).toContain("prune:live");
  expect(keys).not.toContain("prune:stale");
});
