import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, userCosmetics, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { SLOT_REGION } from "@sidekick/core";
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

/** Put one catalog item in a user's wardrobe through the ledger grant path. */
async function own(userId: string, itemKey: string): Promise<void> {
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: `test-own:${itemKey}`,
    outcome: { kind: "item", itemKey },
  });
}

async function equippedKeys(userId: string): Promise<string[]> {
  const rows = await db
    .select({ itemKey: userCosmetics.itemKey })
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.equipped, true)));
  return rows.map((r) => r.itemKey).sort();
}

test("inventory lists owned items with their source and never seeds on read", async () => {
  const userId = await createUser(db);
  const empty = await caller(userId).cosmetics.inventory();
  expect(empty.items).toEqual([]);

  await own(userId, "crown-gold");
  const inv = await caller(userId).cosmetics.inventory();
  expect(inv.items).toEqual([
    { itemKey: "crown-gold", slot: "crown", equipped: false, source: "reward" },
  ]);
});

test("equip clears region siblings — a crown unequips a beanie, other regions stay put", async () => {
  // Sanity-check the slots picked from core really share (or don't share) a region.
  expect(SLOT_REGION.crown).toBe(SLOT_REGION.beanie);
  expect(SLOT_REGION.glasses).not.toBe(SLOT_REGION.crown);

  const userId = await createUser(db);
  const c = caller(userId);
  await own(userId, "crown-gold");
  await own(userId, "beanie-charcoal");
  await own(userId, "glasses-black");

  await c.cosmetics.equip({ itemKey: "beanie-charcoal" });
  const afterGlasses = await c.cosmetics.equip({ itemKey: "glasses-black" });
  expect(await equippedKeys(userId)).toEqual(["beanie-charcoal", "glasses-black"]);

  const afterCrown = await c.cosmetics.equip({ itemKey: "crown-gold" });
  expect(await equippedKeys(userId)).toEqual(["crown-gold", "glasses-black"]);
  expect(afterCrown.stateVersion).toBeGreaterThan(afterGlasses.stateVersion);
});

test("unequip clears just that item and bumps the state version", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await own(userId, "beanie-teal");
  await own(userId, "glasses-pink");
  await c.cosmetics.equip({ itemKey: "beanie-teal" });
  await c.cosmetics.equip({ itemKey: "glasses-pink" });

  const result = await c.cosmetics.unequip({ itemKey: "beanie-teal" });
  expect(result.stateVersion).toBeGreaterThan(0);
  expect(await equippedKeys(userId)).toEqual(["glasses-pink"]);
});

test("equip rejects unowned items, including another user's", async () => {
  const owner = await createUser(db);
  const stranger = await createUser(db);
  await own(owner, "crown-gold");

  await expect(caller(stranger).cosmetics.equip({ itemKey: "crown-gold" })).rejects.toThrow(
    /don't own/,
  );
  await expect(caller(stranger).cosmetics.equip({ itemKey: "nope-nothing" })).rejects.toThrow();

  // The owner's wardrobe is untouched by the stranger's attempts.
  await caller(owner).cosmetics.equip({ itemKey: "crown-gold" });
  expect(await equippedKeys(owner)).toEqual(["crown-gold"]);
  expect(await equippedKeys(stranger)).toEqual([]);
});

test("setSkin round-trips the two cel colors and validates hex", async () => {
  const userId = await createUser(db);
  const c = caller(userId);

  const result = await c.cosmetics.setSkin({ body: "#4a8fe0", shadow: "#3d5bd6" });
  expect(result.stateVersion).toBeGreaterThan(1);

  const rows = await db.select({ skin: users.skin }).from(users).where(eq(users.id, userId));
  expect(rows[0]!.skin).toEqual({ body: "#4a8fe0", shadow: "#3d5bd6" });

  await expect(c.cosmetics.setSkin({ body: "#4a8fe0", shadow: "blue" })).rejects.toThrow();
});
