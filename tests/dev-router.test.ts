import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  type Database,
  guidedSessions,
  ledger,
  sessionFields,
  sessionNotes,
  userCosmetics,
  users,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { sessionFor } from "@sidekick/core";
import { createUser, makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;
let originalEnv: string | undefined;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
});

afterAll(async () => {
  process.env.NODE_ENV = originalEnv;
  await close();
});

function caller(userId: string) {
  return makeCaller(db, textModel("ok"), userId);
}

async function userRow(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]!;
}

/** The ledger invariant every lever must preserve: `users.coins = sum(ledger.coins)`. */
async function assertInvariant(userId: string): Promise<void> {
  const summed = await db
    .select({ total: sql<number>`coalesce(sum(${ledger.coins}), 0)::int` })
    .from(ledger)
    .where(eq(ledger.userId, userId));
  const user = await userRow(userId);
  expect(user.coins).toBe(summed[0]!.total);
}

const frostpeak = sessionFor("frostpeak")!;

async function completeFrostpeak(userId: string): Promise<void> {
  const c = caller(userId);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: {
      fields: { chronotype: "night owl" },
      notes: [{ tag: "weekday_note", text: "garage lab" }],
      astral: { archetype: "the midnight builder", reading: "you come alive at night.", traits: ["curious"] },
    },
  });
}

test("every dev lever is FORBIDDEN outside development", async () => {
  const userId = await createUser(db);
  process.env.NODE_ENV = "test";
  try {
    await expect(caller(userId).dev.adjustCoins({ amount: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller(userId).dev.resetSessions()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(userId).dev.setBond({ bond: 50 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  } finally {
    process.env.NODE_ENV = "development";
  }
});

test("adjustCoins keeps the invariant for grants and spends, and rejects below zero", async () => {
  const userId = await createUser(db);
  const c = caller(userId);

  const up = await c.dev.adjustCoins({ amount: 100 });
  expect(up.coins).toBe(100);
  await assertInvariant(userId);

  const down = await c.dev.adjustCoins({ amount: -30 });
  expect(down.coins).toBe(70);
  expect(down.stateVersion).toBeGreaterThan(up.stateVersion);
  await assertInvariant(userId);

  await expect(c.dev.adjustCoins({ amount: -999 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await userRow(userId)).coins).toBe(70);
  await assertInvariant(userId);
});

test("setBond and setStreak write columns and stamp today", async () => {
  const userId = await createUser(db);
  const c = caller(userId);

  const bond = await c.dev.setBond({ bond: 77 });
  expect(bond.bond).toBe(77);
  expect((await userRow(userId)).bond).toBe(77);

  const streak = await c.dev.setStreak({ count: 5 });
  expect(streak.count).toBe(5);
  const user = await userRow(userId);
  expect(user.streakCount).toBe(5);
  expect(user.streakLastDay).not.toBeNull();
});

test("resetSessions restores pre-session coins and bond, invariant holds", async () => {
  const userId = await createUser(db);
  const before = await userRow(userId);
  await completeFrostpeak(userId);

  const funded = await userRow(userId);
  expect(funded.coins).toBe(before.coins + frostpeak.coins);
  expect(funded.bond).toBe(before.bond + frostpeak.bond);
  await assertInvariant(userId);

  const reset = await caller(userId).dev.resetSessions();
  expect(reset.coins).toBe(before.coins);
  expect(reset.bond).toBe(before.bond);
  await assertInvariant(userId);

  const sessions = await db.select().from(guidedSessions).where(eq(guidedSessions.userId, userId));
  expect(sessions).toHaveLength(0);
  const sessionLedger = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.source, "session")));
  expect(sessionLedger).toHaveLength(0);

  // progress only: the extracted profile survives resetSessions
  const profile = await caller(userId).sessions.profile();
  expect(profile.fields).toEqual({ chronotype: "night owl" });
});

test("resetProfile also clears fields, notes, and the astral card", async () => {
  const userId = await createUser(db);
  await completeFrostpeak(userId);
  expect((await caller(userId).sessions.profile()).astral).not.toBeNull();

  await caller(userId).dev.resetProfile();
  const profile = await caller(userId).sessions.profile();
  expect(profile.fields).toEqual({});
  expect(profile.notes).toEqual([]);
  expect(profile.astral).toBeNull();

  const fields = await db.select().from(sessionFields).where(eq(sessionFields.userId, userId));
  expect(fields).toHaveLength(0);
  const notes = await db.select().from(sessionNotes).where(eq(sessionNotes.userId, userId));
  expect(notes).toHaveLength(0);
  expect((await userRow(userId)).astral).toBeNull();
  await assertInvariant(userId);
});

test("resetDailyBox makes today claimable again and reverses the milestone item", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  // day-3 milestone grants the charcoal beanie; setStreak stamps today so claim's
  // in-transaction touch is a same-day no-op and the tier comes from count 3
  await c.dev.setStreak({ count: 3 });

  const claim = await c.dailyBox.claim();
  expect(claim.box.itemGranted).toBe("beanie-charcoal");
  const owned = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, "beanie-charcoal")));
  expect(owned).toHaveLength(1);
  expect((await c.dailyBox.status()).claimable).toBe(false);
  await assertInvariant(userId);

  const reset = await c.dev.resetDailyBox();
  expect(reset.coins).toBe(0);
  await assertInvariant(userId);

  const goneItem = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, "beanie-charcoal")));
  expect(goneItem).toHaveLength(0);
  const goneLedger = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.source, "daily-box")));
  expect(goneLedger).toHaveLength(0);
  expect((await c.dailyBox.status()).claimable).toBe(true);
});
