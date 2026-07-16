import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, guidedSessions, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { MILESTONES } from "@sidekick/core";
import { grantReward } from "@sidekick/server";
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

test("a fresh user's snapshot has every slice in its starting shape", async () => {
  const userId = await createUser(db);
  const snapshot = await caller(userId).state.snapshot();
  expect(snapshot).toEqual({
    stateVersion: 1,
    coins: 0,
    bond: 10,
    streak: { count: 0, milestoneLadder: MILESTONES },
    dailyBox: { claimable: true, tier: "base" },
    inventory: [],
    skin: null,
    astral: null,
    sessions: [],
  });
});

test("the snapshot reflects progression writes and its stateVersion strictly increases", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const versions: number[] = [(await c.state.snapshot()).stateVersion];

  const touched = await c.streak.touch();
  versions.push((await c.state.snapshot()).stateVersion);
  expect(versions.at(-1)).toBe(touched.stateVersion);

  const claimed = await c.dailyBox.claim();
  versions.push((await c.state.snapshot()).stateVersion);
  expect(versions.at(-1)).toBe(claimed.stateVersion);

  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "test-seed:coins",
    outcome: { kind: "coins", amount: 100 },
  });
  const bought = await c.shop.purchase({ itemKey: "shirt-sky" });
  versions.push((await c.state.snapshot()).stateVersion);
  expect(versions.at(-1)).toBe(bought.stateVersion);

  for (let i = 1; i < versions.length; i++) {
    expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
  }

  const snapshot = await c.state.snapshot();
  expect(snapshot.coins).toBe(bought.coins);
  expect(snapshot.streak.count).toBe(claimed.streak);
  expect(snapshot.dailyBox.claimable).toBe(false);
  expect(snapshot.inventory).toEqual([
    { itemKey: "shirt-sky", slot: "shirt", equipped: false, source: "purchase" },
  ]);
});

test("the sessions slice carries per-session beat/done only", async () => {
  const userId = await createUser(db);
  await db.insert(guidedSessions).values({
    userId,
    sessionId: "s1",
    beat: 3,
    answers: ["something private"],
  });

  const snapshot = await caller(userId).state.snapshot();
  expect(snapshot.sessions).toEqual([{ sessionId: "s1", beat: 3, done: false }]);
});

test("timezone writes validate against real IANA zones", async () => {
  const userId = await createUser(db);
  const c = caller(userId);

  await expect(c.users.updateProfile({ timezone: "foo/bar" })).rejects.toThrow(/invalid timezone/);
  await expect(
    c.location.update({ city: "Springfield", timezone: "Definitely/Nowhere" }),
  ).rejects.toThrow(/invalid timezone/);

  await c.users.updateProfile({ timezone: "America/Chicago" });
  const rows = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  expect(rows[0]!.timezone).toBe("America/Chicago");
});
