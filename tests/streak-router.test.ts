import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { addDays, localDate } from "@sidekick/shared";
import { makeCaller, textModel, createUser } from "./helpers";

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

/** Users default to America/New_York; tests day-shift relative to that zone. */
function today(): string {
  return localDate("America/New_York", new Date());
}

async function setStreak(userId: string, count: number, lastDay: string | null): Promise<void> {
  await db.update(users).set({ streakCount: count, streakLastDay: lastDay }).where(eq(users.id, userId));
}

async function streakRow(userId: string): Promise<{ count: number; stateVersion: number }> {
  const rows = await db
    .select({ count: users.streakCount, stateVersion: users.stateVersion })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0]!;
}

test("a first touch starts the streak at 1; a same-day re-touch is a no-op with no version bump", async () => {
  const userId = await createUser(db);

  const first = await caller(userId).streak.touch();
  expect(first).toEqual({ count: 1, extended: true, stateVersion: first.stateVersion });
  expect(first.stateVersion).toBeGreaterThan(1);

  const again = await caller(userId).streak.touch();
  expect(again).toEqual({ count: 1, extended: false, stateVersion: first.stateVersion });
  expect(await streakRow(userId)).toEqual({ count: 1, stateVersion: first.stateVersion });
});

test("a consecutive-day touch increments", async () => {
  const userId = await createUser(db);
  await setStreak(userId, 4, addDays(today(), -1));

  const touched = await caller(userId).streak.touch();
  expect(touched.count).toBe(5);
  expect(touched.extended).toBe(true);
});

test("a gap resets to 1", async () => {
  const userId = await createUser(db);
  await setStreak(userId, 9, addDays(today(), -3));

  const touched = await caller(userId).streak.touch();
  expect(touched.count).toBe(1);
  expect(touched.extended).toBe(true);
});

test("a concurrent double-touch increments exactly once", async () => {
  const userId = await createUser(db);
  await setStreak(userId, 4, addDays(today(), -1));

  const results = await Promise.all([caller(userId).streak.touch(), caller(userId).streak.touch()]);
  expect((await streakRow(userId)).count).toBe(5);
  expect(results.filter((r) => r.extended)).toHaveLength(1);
  for (const r of results) {
    expect(r.count).toBe(5);
  }
});
