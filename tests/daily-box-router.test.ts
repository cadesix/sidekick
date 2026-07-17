import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { type Database, ledger, userCosmetics, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { addDays, localDate } from "@sidekick/shared";
import { MILESTONES, rollDailyBox } from "@sidekick/core";
import { catalogProduct, claimDailyBox, dailyBoxStatus, grantReward } from "@sidekick/server";
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

/** The plan-20 invariant: `users.coins = sum(ledger.coins)`, always. */
async function ledgerSum(userId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${ledger.coins}), 0)::int` })
    .from(ledger)
    .where(eq(ledger.userId, userId));
  return rows[0]!.total;
}

async function userRow(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  return rows[0]!;
}

// Noon UTC = 8am New York (the default zone) and 2am next day on Kiritimati —
// a fixed instant where a UTC+14 hop crosses a date boundary.
const T0 = new Date("2026-07-16T12:00:00Z");
const NY_DATE = localDate("America/New_York", T0);

test("claiming through the router touches the streak, grants the seeded roll, and replays verbatim", async () => {
  const userId = await createUser(db);

  const claim = await caller(userId).dailyBox.claim();
  const today = localDate("America/New_York", new Date());
  const expected = rollDailyBox(1, today);
  expect(claim.granted).toBe(true);
  expect(claim.streak).toBe(1);
  expect(claim.box).toMatchObject({
    date: today,
    tier: expected.tier,
    coins: expected.coins,
    doubled: expected.doubled,
    milestone: MILESTONES.find((m) => m.day === 1),
    itemGranted: null,
    convertedCoins: 0,
    totalCoins: expected.total,
  });
  expect(claim.coins).toBe(expected.total);
  expect((await userRow(userId)).streakCount).toBe(1);
  expect(await ledgerSum(userId)).toBe(claim.coins);

  const replay = await caller(userId).dailyBox.claim();
  expect(replay.granted).toBe(false);
  expect(replay.box).toEqual(claim.box);
  expect(replay.coins).toBe(claim.coins);
  expect(replay.stateVersion).toBe(claim.stateVersion);
  const rows = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.source, "daily-box")));
  expect(rows).toHaveLength(1);

  const status = await caller(userId).dailyBox.status();
  expect(status.claimable).toBe(false);
});

test("the box tier reflects the streak touched in the same transaction", async () => {
  const userId = await createUser(db);
  // 6 days ending yesterday: the claim's own touch makes it 7 — silver, and the
  // day-7 milestone item lands in the wardrobe.
  await db
    .update(users)
    .set({ streakCount: 6, streakLastDay: addDays(NY_DATE, -1) })
    .where(eq(users.id, userId));

  const status = await dailyBoxStatus(db, userId, T0);
  expect(status).toEqual({
    claimable: true,
    tier: "silver",
    milestone: MILESTONES.find((m) => m.day === 7),
  });

  const claim = await claimDailyBox(db, userId, T0);
  expect(claim.streak).toBe(7);
  expect(claim.box.tier).toBe("silver");
  expect(claim.box.itemGranted).toBe("sneakers-white");
  expect(claim.box.convertedCoins).toBe(0);

  const owned = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, "sneakers-white")));
  expect(owned[0]).toMatchObject({ slot: "sneakers", source: "reward", equipped: false });
  expect(await ledgerSum(userId)).toBe((await userRow(userId)).coins);
});

test("a milestone item already owned converts to its catalog price in coins", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ streakCount: 6, streakLastDay: addDays(NY_DATE, -1) })
    .where(eq(users.id, userId));
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "test-own:sneakers-white",
    outcome: { kind: "item", itemKey: "sneakers-white" },
  });

  const claim = await claimDailyBox(db, userId, T0);
  const dupeValue = catalogProduct("sneakers-white").cost;
  const expected = rollDailyBox(7, NY_DATE);
  expect(claim.box.itemGranted).toBeNull();
  expect(claim.box.convertedCoins).toBe(dupeValue);
  expect(claim.box.totalCoins).toBe(expected.total + dupeValue);
  expect(claim.coins).toBe(claim.box.totalCoins);
  expect(await ledgerSum(userId)).toBe((await userRow(userId)).coins);

  const owned = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, "sneakers-white")));
  expect(owned).toHaveLength(1);
});

test("the 20h guard blocks a claim manufactured by a timezone hop", async () => {
  const userId = await createUser(db);
  const first = await claimDailyBox(db, userId, T0);
  expect(first.box.date).toBe(NY_DATE);

  // Hop to UTC+14, where it's already tomorrow: a new local date, but only an
  // hour has elapsed — the box must stay shut.
  await db.update(users).set({ timezone: "Pacific/Kiritimati" }).where(eq(users.id, userId));
  const hourLater = new Date(T0.getTime() + 60 * 60 * 1000);
  expect(localDate("Pacific/Kiritimati", hourLater)).not.toBe(NY_DATE);

  const status = await dailyBoxStatus(db, userId, hourLater);
  expect(status.claimable).toBe(false);
  await expect(claimDailyBox(db, userId, hourLater)).rejects.toThrow(/isn't ready/);
  const rows = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.source, "daily-box")));
  expect(rows).toHaveLength(1);

  // 21h after the first claim the guard passes and the new local day pays out.
  const dayLater = new Date(T0.getTime() + 21 * 60 * 60 * 1000);
  const second = await claimDailyBox(db, userId, dayLater);
  expect(second.granted).toBe(true);
  expect(second.box.date).toBe(localDate("Pacific/Kiritimati", dayLater));
  expect(await ledgerSum(userId)).toBe((await userRow(userId)).coins);
});
