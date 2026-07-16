import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, actionItems, checkIns, goals, progressEvents, rewards, userCosmetics, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { REDEEM_COST, addDays, grantableCosmetics, localDate, starterCosmetics } from "@sidekick/shared";
import { grantReward, sweepCompletedCheckIns } from "@sidekick/server";
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

async function today(userId: string): Promise<string> {
  const rows = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return localDate(rows[0]!.tz, new Date());
}

/** Build an N-day check-in streak ending today for a fresh user, returning the goal's action item. */
async function seedStreak(userId: string, days: number): Promise<string> {
  const { actionItem } = await caller(userId).goals.adopt({ slug: "get-fit" });
  const t = await today(userId);
  const rows = Array.from({ length: days }, (_, i) => ({
    actionItemId: actionItem!.id,
    date: addDays(t, -i),
    outcome: "hit",
    source: "inferred",
  }));
  await db.insert(progressEvents).values(rows);
  return actionItem!.id;
}

async function completedCheckIn(userId: string): Promise<string> {
  const inserted = await db
    .insert(checkIns)
    .values({ userId, date: await today(userId), status: "completed", completedAt: new Date() })
    .returning({ id: checkIns.id });
  return inserted[0]!.id;
}

test("inventory grants the starter wardrobe on first read and reports zero sparks", async () => {
  const userId = await createUser(db);
  const inv = await caller(userId).cosmetics.inventory();
  expect(inv.sparks).toBe(0);
  const keys = inv.items.map((i) => i.itemKey).sort();
  expect(keys).toEqual(starterCosmetics().map((c) => c.key).sort());
  // Re-reading is idempotent — no duplicate ownership rows.
  const again = await caller(userId).cosmetics.inventory();
  expect(again.items).toHaveLength(inv.items.length);
});

test("equip is single-per-slot and unequip clears it; foreign items are rejected", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.cosmetics.inventory();
  // Give the user a second head item so we can prove slot exclusivity.
  await db.insert(userCosmetics).values({ userId, itemKey: "beanie", slot: "head" });

  await c.cosmetics.equip({ itemKey: "cap" });
  await c.cosmetics.equip({ itemKey: "beanie" });
  const head = await db
    .select({ itemKey: userCosmetics.itemKey, equipped: userCosmetics.equipped })
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.slot, "head")));
  const equipped = head.filter((h) => h.equipped).map((h) => h.itemKey);
  expect(equipped).toEqual(["beanie"]);

  await c.cosmetics.unequip({ itemKey: "beanie" });
  const after = await db
    .select({ equipped: userCosmetics.equipped })
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.slot, "head")));
  expect(after.every((h) => !h.equipped)).toBe(true);

  await expect(c.cosmetics.equip({ itemKey: "crown" })).rejects.toThrow();
});

test("a completed check-in spin grants an item at a streak milestone and never re-rolls", async () => {
  const userId = await createUser(db);
  await seedStreak(userId, 7); // 7 = a guaranteed-item milestone
  const checkInId = await completedCheckIn(userId);
  const c = caller(userId);

  const status = await c.cosmetics.rewardStatus();
  expect(status).toEqual({ status: "available", checkInId });

  const first = await c.cosmetics.spin({ checkInId });
  expect(first.kind).toBe("item");
  expect(first.item).not.toBeNull();
  expect(first.addedToInventory).toBe(true);

  // Idempotent: re-spinning returns the same item, grants nothing new.
  const second = await c.cosmetics.spin({ checkInId });
  expect(second.item?.key).toBe(first.item?.key);
  const rewardRows = await db.select().from(rewards).where(eq(rewards.userId, userId));
  expect(rewardRows).toHaveLength(1);

  const afterStatus = await c.cosmetics.rewardStatus();
  expect(afterStatus.status).toBe("revealed");
});

test("spin refuses a check-in that isn't complete or isn't yours", async () => {
  const pendingUser = await createUser(db);
  const pending = await db
    .insert(checkIns)
    .values({ userId: pendingUser, date: await today(pendingUser), status: "opened" })
    .returning({ id: checkIns.id });
  await expect(caller(pendingUser).cosmetics.spin({ checkInId: pending[0]!.id })).rejects.toThrow();

  const owner = await createUser(db);
  const stranger = await createUser(db);
  const done = await completedCheckIn(owner);
  await expect(caller(stranger).cosmetics.spin({ checkInId: done })).rejects.toThrow();
});

test("the reward cron sweeps completed check-ins idempotently", async () => {
  const userId = await createUser(db);
  await seedStreak(userId, 3);
  await completedCheckIn(userId);

  const first = await sweepCompletedCheckIns(db, new Date());
  expect(first.granted).toBeGreaterThanOrEqual(1);
  const rewardCount = (await db.select().from(rewards).where(eq(rewards.userId, userId))).length;
  expect(rewardCount).toBe(1);

  const second = await sweepCompletedCheckIns(db, new Date());
  const rewardCountAfter = (await db.select().from(rewards).where(eq(rewards.userId, userId))).length;
  expect(rewardCountAfter).toBe(1);
  expect(second.granted).toBe(0);
});

test("grantReward is the idempotent generic path (deep-talks source:'event')", async () => {
  const userId = await createUser(db);
  const outcome = { kind: "item" as const, itemKey: "trophy", rarity: "legendary" as const };

  const first = await grantReward(db, { userId, source: "event", dedupeKey: "deep-talk:s1", outcome });
  expect(first.granted).toBe(true);
  expect(first.addedToInventory).toBe(true);

  const second = await grantReward(db, { userId, source: "event", dedupeKey: "deep-talk:s1", outcome });
  expect(second.granted).toBe(false);
  const owned = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, "trophy")));
  expect(owned).toHaveLength(1);
});

test("sparks accumulate and redeem for a chosen item; underfunded redeem is refused", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.cosmetics.inventory();

  await expect(c.cosmetics.redeem({ itemKey: "crown" })).rejects.toThrow();

  await grantReward(db, {
    userId,
    source: "spinner",
    dedupeKey: "spin:manual",
    outcome: { kind: "sparks", amount: REDEEM_COST },
  });
  const funded = await c.cosmetics.inventory();
  expect(funded.sparks).toBe(REDEEM_COST);

  const target = grantableCosmetics().find((g) => !starterCosmetics().some((s) => s.key === g.key))!;
  const redeemed = await c.cosmetics.redeem({ itemKey: target.key });
  expect(redeemed.sparks).toBe(0);
  const owns = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, target.key)));
  expect(owns).toHaveLength(1);
});
