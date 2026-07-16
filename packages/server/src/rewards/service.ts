import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type Database,
  actionItems,
  goals,
  ledger,
  progressEvents,
  userCosmetics,
  users,
} from "@sidekick/db";
import { currentStreak } from "@sidekick/shared";
import {
  type Product,
  type WardrobeSlot,
  START_COINS,
  START_INVENTORY,
  WARDROBE_SLOTS,
  buildProducts,
  regionSiblings,
} from "@sidekick/core";

type LedgerRow = typeof ledger.$inferSelect;

/** renderKey → product for the whole purchasable catalog (pure core data, built once). */
const PRODUCT_BY_KEY = new Map<string, Product>(buildProducts().map((p) => [p.renderKey, p]));

/**
 * Resolve a renderKey against the core catalog — the canonical item identity
 * (plan 20 decision 3). Slot and cost always come from here, never from the
 * client. Throws on a key the catalog doesn't sell.
 */
export function catalogProduct(itemKey: string): Product {
  const product = PRODUCT_BY_KEY.get(itemKey);
  if (!product) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown item ${itemKey}` });
  }
  return product;
}

function isWardrobeSlot(slot: string): slot is WardrobeSlot {
  return WARDROBE_SLOTS.some((s) => s === slot);
}

/**
 * Bump `users.stateVersion` and return the new value (plan 20 decision 11).
 * Every progression write flows through this (or folds the bump into its own
 * UPDATE), so every mutation can return `{ stateVersion, ...changed }` for the
 * client's compare-before-patch cache rule.
 */
export async function bumpStateVersion(db: Database, userId: string): Promise<number> {
  const rows = await db
    .update(users)
    .set({ stateVersion: sql`${users.stateVersion} + 1` })
    .where(eq(users.id, userId))
    .returning({ stateVersion: users.stateVersion });
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return row.stateVersion;
}

/** Apply a signed coin delta and the stateVersion bump in one UPDATE. */
async function applyUserDelta(
  db: Database,
  userId: string,
  coinsDelta: number,
): Promise<{ coins: number; stateVersion: number }> {
  const rows = await db
    .update(users)
    .set({
      coins: sql`${users.coins} + ${coinsDelta}`,
      stateVersion: sql`${users.stateVersion} + 1`,
    })
    .where(eq(users.id, userId))
    .returning({ coins: users.coins, stateVersion: users.stateVersion });
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return row;
}

async function existingEntry(db: Database, userId: string, dedupeKey: string): Promise<LedgerRow> {
  const rows = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, dedupeKey)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ledger entry lost" });
  }
  return row;
}

async function userBalance(
  db: Database,
  userId: string,
): Promise<{ coins: number; stateVersion: number }> {
  const rows = await db
    .select({ coins: users.coins, stateVersion: users.stateVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return row;
}

export type GrantOutcome =
  | { kind: "coins"; amount: number }
  | { kind: "item"; itemKey: string; source?: "reward" | "starter" };

export type GrantResult = {
  entry: LedgerRow;
  /** False when the `dedupeKey` already existed — the grant was a replayed no-op. */
  granted: boolean;
  /** True when an item was newly added to the wardrobe (not a dupe). */
  addedToInventory: boolean;
  /** The user's coin balance after this call. */
  coins: number;
  /** `users.stateVersion` after this call (unchanged on a replay). */
  stateVersion: number;
};

/**
 * THE grant path of the signed ledger (plan 20 decision 2). Every faucet — the
 * starter grant, daily box, sessions, deep-talk events — flows through here.
 * Idempotent on `(userId, dedupeKey)`: a replay returns the existing row
 * (including its persisted `meta`, so structured rewards replay exactly what was
 * granted) and changes NO state. A fresh grant writes the ledger row and, in the
 * same transaction, the `users.coins` update (coin grants) or the
 * `userCosmetics` insert (item grants, slot resolved from the core catalog),
 * plus the stateVersion bump.
 */
export async function grantReward(
  db: Database,
  input: {
    userId: string;
    source: string;
    dedupeKey: string;
    outcome: GrantOutcome;
    meta?: unknown;
  },
): Promise<GrantResult> {
  const { userId, source, dedupeKey, outcome, meta } = input;
  if (outcome.kind === "item") {
    catalogProduct(outcome.itemKey);
  }
  return db.transaction(async (tx) => {
    const values =
      outcome.kind === "item"
        ? { userId, source, dedupeKey, kind: "item" as const, itemKey: outcome.itemKey, meta }
        : { userId, source, dedupeKey, kind: "coins" as const, coins: outcome.amount, meta };
    const inserted = await tx
      .insert(ledger)
      .values(values)
      .onConflictDoNothing({ target: [ledger.userId, ledger.dedupeKey] })
      .returning();
    const entry = inserted[0];

    if (!entry) {
      const existing = await existingEntry(tx, userId, dedupeKey);
      const balance = await userBalance(tx, userId);
      return { entry: existing, granted: false, addedToInventory: false, ...balance };
    }

    if (outcome.kind === "coins") {
      const balance = await applyUserDelta(tx, userId, outcome.amount);
      return { entry, granted: true, addedToInventory: false, ...balance };
    }

    const { slot } = catalogProduct(outcome.itemKey);
    const owned = await tx
      .insert(userCosmetics)
      .values({ userId, itemKey: outcome.itemKey, slot, source: outcome.source ?? "reward" })
      .onConflictDoNothing({ target: [userCosmetics.userId, userCosmetics.itemKey] })
      .returning({ id: userCosmetics.id });
    const balance = await applyUserDelta(tx, userId, 0);
    return { entry, granted: true, addedToInventory: owned.length > 0, ...balance };
  });
}

export type SpendResult = {
  entry: LedgerRow;
  /** False when the `dedupeKey` already existed — the spend was a replayed no-op. */
  spent: boolean;
  /** The user's coin balance after this call. */
  coins: number;
  /** `users.stateVersion` after this call (unchanged on a replay). */
  stateVersion: number;
};

/**
 * THE spend path of the signed ledger: a negative row plus a conditional
 * `coins >= cost` decrement, one transaction — no oversell under concurrency.
 * Idempotent on `(userId, dedupeKey)`: a replayed spend returns the existing row
 * and never double-charges. An insufficient balance rejects with BAD_REQUEST and
 * leaves no ledger row. `itemKey` is recorded on the row for purchases; the
 * ownership insert belongs to the caller (in its own transaction around this).
 */
export async function spendCoins(
  db: Database,
  input: {
    userId: string;
    cost: number;
    source: string;
    dedupeKey: string;
    itemKey?: string;
    meta?: unknown;
  },
): Promise<SpendResult> {
  const { userId, cost, source, dedupeKey, itemKey, meta } = input;
  if (!Number.isInteger(cost) || cost <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cost must be a positive integer" });
  }
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(ledger)
      .values({ userId, source, dedupeKey, kind: "coins", coins: -cost, itemKey, meta })
      .onConflictDoNothing({ target: [ledger.userId, ledger.dedupeKey] })
      .returning();
    const entry = inserted[0];

    if (!entry) {
      const existing = await existingEntry(tx, userId, dedupeKey);
      const balance = await userBalance(tx, userId);
      return { entry: existing, spent: false, ...balance };
    }

    const updated = await tx
      .update(users)
      .set({
        coins: sql`${users.coins} - ${cost}`,
        stateVersion: sql`${users.stateVersion} + 1`,
      })
      .where(and(eq(users.id, userId), sql`${users.coins} >= ${cost}`))
      .returning({ coins: users.coins, stateVersion: users.stateVersion });
    const balance = updated[0];
    if (!balance) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "not enough coins" });
    }
    return { entry, spent: true, ...balance };
  });
}

/**
 * Seed a brand-new account's economy (plan 20 §server changes): the opening
 * `starter:coins` ledger grant and the starter outfit owned AND equipped
 * (`source: 'starter'`) — a fresh account boots wearing the sky shirt. Called
 * inside the user-creation transaction; idempotent via the grant dedupe key and
 * the `(userId, itemKey)` unique index.
 */
export async function seedStarterState(db: Database, userId: string): Promise<void> {
  await grantReward(db, {
    userId,
    source: "starter",
    dedupeKey: "starter:coins",
    outcome: { kind: "coins", amount: START_COINS },
  });
  if (START_INVENTORY.length === 0) {
    return;
  }
  await db
    .insert(userCosmetics)
    .values(
      START_INVENTORY.map((itemKey) => ({
        userId,
        itemKey,
        slot: catalogProduct(itemKey).slot,
        source: "starter",
        equipped: true,
      })),
    )
    .onConflictDoNothing({ target: [userCosmetics.userId, userCosmetics.itemKey] });
}

/** The user's overall check-in streak on their local `today` (mirrors goals.list). */
export async function userStreak(db: Database, userId: string, today: string): Promise<number> {
  const hitRows = await db
    .select({ date: progressEvents.date })
    .from(progressEvents)
    .innerJoin(actionItems, eq(progressEvents.actionItemId, actionItems.id))
    .innerJoin(goals, eq(actionItems.goalId, goals.id))
    .where(and(eq(goals.userId, userId), inArray(progressEvents.outcome, ["hit", "partial"])));
  return currentStreak(
    hitRows.map((r) => r.date),
    today,
  );
}

export async function assertOwned(
  db: Database,
  userId: string,
  itemKey: string,
): Promise<{ slot: string }> {
  const rows = await db
    .select({ slot: userCosmetics.slot })
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemKey)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "FORBIDDEN", message: "you don't own that item" });
  }
  return row;
}

/**
 * Equip one owned item, clearing anything worn anywhere in its body region —
 * core's exclusivity rule (a crown replaces a beanie, a hoodie takes the shirt
 * off) enforced transactionally, one stateVersion bump.
 */
export async function equipCosmetic(
  db: Database,
  userId: string,
  itemKey: string,
): Promise<{ stateVersion: number }> {
  return db.transaction(async (tx) => {
    const { slot } = await assertOwned(tx, userId, itemKey);
    let clearSlots: string[] = [slot];
    if (isWardrobeSlot(slot)) {
      clearSlots = [slot, ...regionSiblings(slot)];
    }
    await tx
      .update(userCosmetics)
      .set({ equipped: false })
      .where(and(eq(userCosmetics.userId, userId), inArray(userCosmetics.slot, clearSlots)));
    await tx
      .update(userCosmetics)
      .set({ equipped: true })
      .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemKey)));
    const stateVersion = await bumpStateVersion(tx, userId);
    return { stateVersion };
  });
}

export async function unequipCosmetic(
  db: Database,
  userId: string,
  itemKey: string,
): Promise<{ stateVersion: number }> {
  return db.transaction(async (tx) => {
    await assertOwned(tx, userId, itemKey);
    await tx
      .update(userCosmetics)
      .set({ equipped: false })
      .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemKey)));
    const stateVersion = await bumpStateVersion(tx, userId);
    return { stateVersion };
  });
}
