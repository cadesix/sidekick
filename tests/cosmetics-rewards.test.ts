import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { type Database, ledger, userCosmetics, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { START_COINS, START_INVENTORY } from "@sidekick/core";
import {
  bumpStateVersion,
  findOrCreateUserForProvider,
  grantReward,
  spendCoins,
} from "@sidekick/server";
import { createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

/** The plan-20 invariant: `users.coins = sum(ledger.coins)`, always. */
async function ledgerSum(userId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${ledger.coins}), 0)::int` })
    .from(ledger)
    .where(eq(ledger.userId, userId));
  return rows[0]!.total;
}

async function balance(userId: string): Promise<{ coins: number; stateVersion: number }> {
  const rows = await db
    .select({ coins: users.coins, stateVersion: users.stateVersion })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0]!;
}

test("a coin grant credits once; a replay returns the identical row (incl. meta) and changes nothing", async () => {
  const userId = await createUser(db);
  const meta = { contents: [{ kind: "coins", amount: 40 }], claimedAt: "2026-07-16T12:00:00Z" };

  const first = await grantReward(db, {
    userId,
    source: "daily-box",
    dedupeKey: "daily-box:2026-07-16",
    outcome: { kind: "coins", amount: 40 },
    meta,
  });
  expect(first.granted).toBe(true);
  expect(first.coins).toBe(40);
  expect(first.entry.meta).toEqual(meta);

  const replay = await grantReward(db, {
    userId,
    source: "daily-box",
    dedupeKey: "daily-box:2026-07-16",
    outcome: { kind: "coins", amount: 999 },
    meta: { drifted: true },
  });
  expect(replay.granted).toBe(false);
  expect(replay.entry).toEqual(first.entry);
  expect(replay.coins).toBe(40);
  expect(replay.stateVersion).toBe(first.stateVersion);

  expect(await balance(userId)).toEqual({ coins: 40, stateVersion: first.stateVersion });
  expect(await ledgerSum(userId)).toBe(40);
});

test("an item grant resolves its slot from the core catalog and records its source", async () => {
  const userId = await createUser(db);

  const granted = await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "chest:starfall",
    outcome: { kind: "item", itemKey: "crown-gold" },
  });
  expect(granted.granted).toBe(true);
  expect(granted.addedToInventory).toBe(true);

  const owned = await db.select().from(userCosmetics).where(eq(userCosmetics.userId, userId));
  expect(owned).toHaveLength(1);
  expect(owned[0]).toMatchObject({
    itemKey: "crown-gold",
    slot: "crown",
    source: "reward",
    equipped: false,
  });

  const replay = await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "chest:starfall",
    outcome: { kind: "item", itemKey: "crown-gold" },
  });
  expect(replay.granted).toBe(false);
  expect(replay.addedToInventory).toBe(false);

  await expect(
    grantReward(db, {
      userId,
      source: "event",
      dedupeKey: "chest:bogus",
      outcome: { kind: "item", itemKey: "crown-plastic" },
    }),
  ).rejects.toThrow(/unknown item/);
  expect(await db.select().from(userCosmetics).where(eq(userCosmetics.userId, userId))).toHaveLength(1);
});

test("spending more than the balance is rejected and leaves no ledger row", async () => {
  const userId = await createUser(db);
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "seed:coins",
    outcome: { kind: "coins", amount: 30 },
  });

  await expect(
    spendCoins(db, { userId, cost: 50, source: "shop", dedupeKey: "purchase:hat-khaki" }),
  ).rejects.toThrow(/not enough coins/);

  expect((await balance(userId)).coins).toBe(30);
  expect(await ledgerSum(userId)).toBe(30);
  const rows = await db.select().from(ledger).where(eq(ledger.userId, userId));
  expect(rows).toHaveLength(1);
});

test("a replayed spend never double-charges", async () => {
  const userId = await createUser(db);
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "seed:coins",
    outcome: { kind: "coins", amount: 100 },
  });

  const first = await spendCoins(db, {
    userId,
    cost: 60,
    source: "shop",
    dedupeKey: "purchase:crown-gold",
    itemKey: "crown-gold",
  });
  expect(first.spent).toBe(true);
  expect(first.coins).toBe(40);
  expect(first.entry.coins).toBe(-60);
  expect(first.entry.itemKey).toBe("crown-gold");

  const replay = await spendCoins(db, {
    userId,
    cost: 60,
    source: "shop",
    dedupeKey: "purchase:crown-gold",
    itemKey: "crown-gold",
  });
  expect(replay.spent).toBe(false);
  expect(replay.entry).toEqual(first.entry);
  expect(replay.coins).toBe(40);
  expect(replay.stateVersion).toBe(first.stateVersion);
  expect(await ledgerSum(userId)).toBe(40);
});

test("concurrent spends can't oversell — the conditional decrement holds", async () => {
  const userId = await createUser(db);
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "seed:coins",
    outcome: { kind: "coins", amount: 100 },
  });

  const results = await Promise.allSettled([
    spendCoins(db, { userId, cost: 60, source: "shop", dedupeKey: "purchase:a" }),
    spendCoins(db, { userId, cost: 60, source: "shop", dedupeKey: "purchase:b" }),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  expect(fulfilled).toHaveLength(1);

  const after = await balance(userId);
  expect(after.coins).toBe(40);
  expect(await ledgerSum(userId)).toBe(40);
});

test("the ledger invariant holds after a mixed grant/spend/replay sequence", async () => {
  const userId = await createUser(db);

  await grantReward(db, { userId, source: "starter", dedupeKey: "starter:coins", outcome: { kind: "coins", amount: 150 } });
  await grantReward(db, { userId, source: "event", dedupeKey: "deep-talk:x", outcome: { kind: "coins", amount: 6 } });
  await grantReward(db, { userId, source: "event", dedupeKey: "chest:isle", outcome: { kind: "item", itemKey: "beanie-teal" } });
  await spendCoins(db, { userId, cost: 45, source: "shop", dedupeKey: "purchase:scarf-red", itemKey: "scarf-red" });
  await grantReward(db, { userId, source: "event", dedupeKey: "deep-talk:x", outcome: { kind: "coins", amount: 6 } });
  await spendCoins(db, { userId, cost: 45, source: "shop", dedupeKey: "purchase:scarf-red", itemKey: "scarf-red" });
  await expect(
    spendCoins(db, { userId, cost: 10_000, source: "shop", dedupeKey: "purchase:crown-gold" }),
  ).rejects.toThrow(/not enough coins/);

  const user = await balance(userId);
  expect(user.coins).toBe(150 + 6 - 45);
  expect(await ledgerSum(userId)).toBe(user.coins);
});

test("registration seeds 150 coins through the ledger and the starter outfit, equipped", async () => {
  const { userId, isNewUser } = await findOrCreateUserForProvider(db, {
    provider: "apple",
    providerAccountId: "apple:starter-seed",
  });
  expect(isNewUser).toBe(true);

  expect(START_COINS).toBe(150);
  const user = await balance(userId);
  expect(user.coins).toBe(START_COINS);
  expect(user.stateVersion).toBeGreaterThanOrEqual(1);
  expect(await ledgerSum(userId)).toBe(START_COINS);

  const starterRows = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, "starter:coins")));
  expect(starterRows).toHaveLength(1);
  expect(starterRows[0]).toMatchObject({ source: "starter", kind: "coins", coins: START_COINS });

  const items = await db.select().from(userCosmetics).where(eq(userCosmetics.userId, userId));
  expect(items.map((i) => i.itemKey).sort()).toEqual([...START_INVENTORY].sort());
  for (const item of items) {
    expect(item.equipped).toBe(true);
    expect(item.source).toBe("starter");
  }
  expect(items.some((i) => i.itemKey === "shirt-sky")).toBe(true);

  // Signing in again with the same identity never re-seeds.
  const again = await findOrCreateUserForProvider(db, {
    provider: "apple",
    providerAccountId: "apple:starter-seed",
  });
  expect(again).toEqual({ userId, isNewUser: false });
  expect((await balance(userId)).coins).toBe(START_COINS);
});

test("bumpStateVersion is monotonic", async () => {
  const userId = await createUser(db);
  const first = await bumpStateVersion(db, userId);
  const second = await bumpStateVersion(db, userId);
  expect(first).toBe(2);
  expect(second).toBe(first + 1);
});
