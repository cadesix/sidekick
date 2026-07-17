import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { ledger, userCosmetics, users } from "@sidekick/db";
import { cosmeticItemInput, localDate } from "@sidekick/shared";
import { buildProducts, todaysShop } from "@sidekick/core";
import { protectedProcedure, router } from "../trpc";
import { catalogProduct, spendCoins } from "../rewards/service";

/** The purchasable catalog — pure core data, identical to the client's (plan 20 decision 3). */
const PRODUCTS = buildProducts();

/**
 * The shop (plan 20 §shop router). `today` computes the seeded rotation
 * server-side with the user's local date — the same `todaysShop(products, day)`
 * call the client used to make, so the rotation the user sees is unchanged.
 * Prices travel in the payload (decision 5); art stays client-side by renderKey
 * and rarity derives client-side from the returned cost.
 */
export const shopRouter = router({
  today: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ timezone: users.timezone, coins: users.coins })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    const user = rows[0];
    if (!user) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
    }
    const date = localDate(user.timezone, new Date());
    const { featured, daily } = todaysShop(PRODUCTS, date);
    return { date, coins: user.coins, featured, daily };
  }),

  /**
   * Buy one catalog item by renderKey. The price is always the catalog's —
   * never a client number. One transaction: the idempotent ledger spend
   * (`purchase:<renderKey>`) plus the ownership insert, so a replayed purchase
   * returns successfully without double-charging, while an item owned through
   * any other source rejects before a coin moves.
   */
  purchase: protectedProcedure.input(cosmeticItemInput).mutation(async ({ ctx, input }) => {
    const { db, userId } = ctx;
    const product = catalogProduct(input.itemKey);
    const dedupeKey = `purchase:${product.renderKey}`;
    return db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: userCosmetics.id })
        .from(userCosmetics)
        .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, product.renderKey)))
        .limit(1);
      if (owned[0]) {
        const prior = await tx
          .select({ id: ledger.id })
          .from(ledger)
          .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, dedupeKey)))
          .limit(1);
        if (!prior[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "you already own that item" });
        }
        const balance = await tx
          .select({ coins: users.coins, stateVersion: users.stateVersion })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const current = balance[0];
        if (!current) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
        }
        return { ...current, itemKey: product.renderKey };
      }

      const spend = await spendCoins(tx, {
        userId,
        cost: product.cost,
        source: "shop",
        dedupeKey,
        itemKey: product.renderKey,
      });
      await tx
        .insert(userCosmetics)
        .values({ userId, itemKey: product.renderKey, slot: product.slot, source: "purchase" })
        .onConflictDoNothing({ target: [userCosmetics.userId, userCosmetics.itemKey] });
      return { stateVersion: spend.stateVersion, coins: spend.coins, itemKey: product.renderKey };
    });
  }),
});
