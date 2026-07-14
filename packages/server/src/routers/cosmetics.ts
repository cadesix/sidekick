import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type Database, checkIns, userCosmetics, users } from "@sidekick/db";
import { getCosmetic, localDate, userTimezone } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import {
  ensureStarterCosmetics,
  equipCosmetic,
  markRewardRevealed,
  redeemSparks,
  spinForCheckIn,
  todayRewardStatus,
  unequipCosmetic,
} from "../rewards/service";

async function sparksBalance(db: Database, userId: string): Promise<number> {
  const rows = await db.select({ sparks: users.sparks }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.sparks ?? 0;
}

/** Reward-row shape → the client's spinner payload (item details resolved from the code catalog). */
function rewardView(reward: { kind: string; itemKey: string | null; sparks: number | null }) {
  if (reward.kind === "item" && reward.itemKey) {
    const item = getCosmetic(reward.itemKey);
    return {
      kind: "item" as const,
      item: item
        ? { key: item.key, name: item.name, slot: item.slot, rarity: item.rarity, glyph: item.glyph }
        : null,
      sparks: null,
    };
  }
  return { kind: "sparks" as const, item: null, sparks: reward.sparks ?? 0 };
}

export const cosmeticsRouter = router({
  /** The user's wardrobe (04 / 07 §10). Grants starter items on first read. */
  inventory: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    await ensureStarterCosmetics(db, userId);
    const rows = await db
      .select({
        itemKey: userCosmetics.itemKey,
        slot: userCosmetics.slot,
        equipped: userCosmetics.equipped,
      })
      .from(userCosmetics)
      .where(eq(userCosmetics.userId, userId));
    return { items: rows, sparks: await sparksBalance(db, userId) };
  }),

  equip: protectedProcedure
    .input(z.object({ itemKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await equipCosmetic(ctx.db, ctx.userId, input.itemKey);
      return { ok: true };
    }),

  unequip: protectedProcedure
    .input(z.object({ itemKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await unequipCosmetic(ctx.db, ctx.userId, input.itemKey);
      return { ok: true };
    }),

  /** Spend sparks to pick any unowned cosmetic (04 pity timer). */
  redeem: protectedProcedure
    .input(z.object({ itemKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { sparks } = await redeemSparks(ctx.db, ctx.userId, input.itemKey);
      return { ok: true, sparks };
    }),

  /** Whether the home screen should present today's spinner (04 / 07 §6). */
  rewardStatus: protectedProcedure.query(async ({ ctx }) => {
    const today = localDate(await userTimezone(ctx.db, ctx.userId), new Date());
    return todayRewardStatus(ctx.db, ctx.userId, today);
  }),

  /**
   * Roll (or re-read) the daily-spinner reward for a completed check-in and mark
   * it revealed. Server-authoritative and idempotent per check-in — the client
   * only animates the returned result.
   */
  spin: protectedProcedure
    .input(z.object({ checkInId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      const rows = await db
        .select({ userId: checkIns.userId, status: checkIns.status })
        .from(checkIns)
        .where(eq(checkIns.id, input.checkInId))
        .limit(1);
      const checkIn = rows[0];
      if (!checkIn || checkIn.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "check-in not found" });
      }
      if (checkIn.status !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "check-in isn't complete yet" });
      }
      const today = localDate(await userTimezone(db, userId), new Date());
      const result = await spinForCheckIn(db, { userId, checkInId: input.checkInId, today });
      await markRewardRevealed(db, result.reward.id);
      return {
        ...rewardView(result.reward),
        addedToInventory: result.addedToInventory,
        sparksTotal: await sparksBalance(db, userId),
      };
    }),
});
