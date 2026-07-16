import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { type Database, ledger, userCosmetics, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { buildProducts, todaysShop } from "@sidekick/core";
import { catalogProduct, grantReward } from "@sidekick/server";
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

async function seedCoins(userId: string, amount: number): Promise<void> {
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "test-seed:coins",
    outcome: { kind: "coins", amount },
  });
}

async function balance(userId: string): Promise<{ coins: number; stateVersion: number }> {
  const rows = await db
    .select({ coins: users.coins, stateVersion: users.stateVersion })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0]!;
}

test("shop.today is the deterministic core rotation for the user's local date", async () => {
  const userId = await createUser(db);
  const first = await caller(userId).shop.today();
  const again = await caller(userId).shop.today();
  expect(again).toEqual(first);

  // The exact rotation the client used to compute on-device: same catalog, same seed.
  const expected = todaysShop(buildProducts(), first.date);
  expect(first.featured.map((p) => p.renderKey)).toEqual(expected.featured.map((p) => p.renderKey));
  expect(first.daily.map((p) => p.renderKey)).toEqual(expected.daily.map((p) => p.renderKey));
  expect(first.featured).toHaveLength(2);
  expect(first.daily.length).toBeLessThanOrEqual(4);
  expect(first.coins).toBe(0);
  for (const p of [...first.featured, ...first.daily]) {
    expect(p.cost).toBe(catalogProduct(p.renderKey).cost);
    expect(p.name.length).toBeGreaterThan(0);
    expect(p.slot.length).toBeGreaterThan(0);
  }

  // Ownership never distorts the rotation — a stocked wardrobe sees the same shop.
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "test-own:crown-gold",
    outcome: { kind: "item", itemKey: "crown-gold" },
  });
  const stocked = await caller(userId).shop.today();
  expect(stocked.featured).toEqual(first.featured);
  expect(stocked.daily).toEqual(first.daily);
});

test("purchase rejects unknown items and insufficient balances without moving a coin", async () => {
  const userId = await createUser(db);
  await expect(caller(userId).shop.purchase({ itemKey: "crown-plastic" })).rejects.toThrow(
    /unknown item/,
  );
  await expect(caller(userId).shop.purchase({ itemKey: "shirt-sky" })).rejects.toThrow(
    /not enough coins/,
  );
  expect(await balance(userId)).toMatchObject({ coins: 0 });
  expect(await db.select().from(ledger).where(eq(ledger.userId, userId))).toHaveLength(0);
});

test("purchase charges the catalog price once; a replay returns success without a second charge", async () => {
  const userId = await createUser(db);
  await seedCoins(userId, 100);
  const cost = catalogProduct("shirt-sky").cost;

  const bought = await caller(userId).shop.purchase({ itemKey: "shirt-sky" });
  expect(bought.itemKey).toBe("shirt-sky");
  expect(bought.coins).toBe(100 - cost);

  const owned = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, "shirt-sky")));
  expect(owned[0]).toMatchObject({ slot: "shirt", source: "purchase", equipped: false });

  const replay = await caller(userId).shop.purchase({ itemKey: "shirt-sky" });
  expect(replay).toEqual(bought);
  expect(await balance(userId)).toEqual({ coins: bought.coins, stateVersion: bought.stateVersion });

  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${ledger.coins}), 0)::int` })
    .from(ledger)
    .where(eq(ledger.userId, userId));
  expect(rows[0]!.total).toBe(bought.coins);
});

test("an item owned through a reward can't be bought", async () => {
  const userId = await createUser(db);
  await seedCoins(userId, 500);
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: "test-own:crown-gold",
    outcome: { kind: "item", itemKey: "crown-gold" },
  });

  await expect(caller(userId).shop.purchase({ itemKey: "crown-gold" })).rejects.toThrow(
    /already own/,
  );
  expect((await balance(userId)).coins).toBe(500);
});

test("a same-item purchase race charges once and leaves one wardrobe row", async () => {
  const userId = await createUser(db);
  await seedCoins(userId, 200);
  const cost = catalogProduct("beanie-charcoal").cost;

  const results = await Promise.allSettled([
    caller(userId).shop.purchase({ itemKey: "beanie-charcoal" }),
    caller(userId).shop.purchase({ itemKey: "beanie-charcoal" }),
  ]);
  expect(results.every((r) => r.status === "fulfilled")).toBe(true);

  expect((await balance(userId)).coins).toBe(200 - cost);
  const owned = await db
    .select()
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, "beanie-charcoal")));
  expect(owned).toHaveLength(1);
  const spendRows = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, "purchase:beanie-charcoal")));
  expect(spendRows).toHaveLength(1);
});
