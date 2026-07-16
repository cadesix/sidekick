import { healthSyncInputSchema } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { disconnectHealth, healthStatus, syncHealthDays } from "../health/sync";

/**
 * Apple Health surface (12). The app posts the trailing week of on-device
 * aggregates on foreground; `sync` upserts them and runs device-verified goal
 * logging. `disconnect` deletes every synced day ("deleted from our side too").
 */
export const healthRouter = router({
  sync: protectedProcedure
    .input(healthSyncInputSchema)
    .mutation(({ ctx, input }) => syncHealthDays(ctx.db, ctx.userId, input.days)),

  status: protectedProcedure.query(({ ctx }) => healthStatus(ctx.db, ctx.userId)),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await disconnectHealth(ctx.db, ctx.userId);
    return { ok: true as const, ...result };
  }),
});
