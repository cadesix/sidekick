import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { userCosmetics, users } from "@sidekick/db";
import { cosmeticItemInput, setSkinInput } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { equipCosmetic, unequipCosmetic } from "../rewards/service";

export const cosmeticsRouter = router({
  /** The user's wardrobe (plan 20). Ownership is seeded at registration, never here. */
  inventory: protectedProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select({
        itemKey: userCosmetics.itemKey,
        slot: userCosmetics.slot,
        equipped: userCosmetics.equipped,
        source: userCosmetics.source,
      })
      .from(userCosmetics)
      .where(eq(userCosmetics.userId, ctx.userId));
    return { items };
  }),

  equip: protectedProcedure.input(cosmeticItemInput).mutation(({ ctx, input }) => {
    return equipCosmetic(ctx.db, ctx.userId, input.itemKey);
  }),

  unequip: protectedProcedure.input(cosmeticItemInput).mutation(({ ctx, input }) => {
    return unequipCosmetic(ctx.db, ctx.userId, input.itemKey);
  }),

  /** Set the sidekick's two cel skin colors (`users.skin`, plan 20). */
  setSkin: protectedProcedure.input(setSkinInput).mutation(async ({ ctx, input }) => {
    const rows = await ctx.db
      .update(users)
      .set({
        skin: { body: input.body, shadow: input.shadow },
        stateVersion: sql`${users.stateVersion} + 1`,
      })
      .where(eq(users.id, ctx.userId))
      .returning({ stateVersion: users.stateVersion });
    const row = rows[0];
    if (!row) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
    }
    return { stateVersion: row.stateVersion };
  }),
});
