import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  adjustCoins,
  resetDailyBox,
  resetOnboarding,
  resetProfile,
  resetSessions,
  setBond,
  setStreak,
} from "../dev/service";
import { protectedProcedure, router } from "../trpc";

/**
 * Dev-only levers, gated exactly like `devLogin` (auth/dev-login.ts): fail-closed
 * unless `NODE_ENV === "development"` (unset counts as not-dev), so a prod server
 * refuses them even if called directly.
 */
const devProcedure = protectedProcedure.use(({ next }) => {
  if (process.env.NODE_ENV !== "development") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Dev levers are only available in development" });
  }
  return next();
});

/**
 * The DevPanel's levers (plan 20 §dev router), replacing its old direct store
 * writes. Every lever preserves the ledger invariant and returns
 * `{ stateVersion, ...changed }` for the client's compare-before-patch cache.
 */
export const devRouter = router({
  /** A signed coin adjustment through a `dev-adjust:<uuid>` ledger row. */
  adjustCoins: devProcedure
    .input(z.object({ amount: z.number().int().refine((n) => n !== 0, "amount must be non-zero") }))
    .mutation(({ ctx, input }) => adjustCoins(ctx.db, ctx.userId, input.amount)),

  /** Set bond outright (10–100). */
  setBond: devProcedure
    .input(z.object({ bond: z.number().int().min(10).max(100) }))
    .mutation(({ ctx, input }) => setBond(ctx.db, ctx.userId, input.bond)),

  /** Set the app-open streak count (stamps `streakLastDay` to local today). */
  setStreak: devProcedure
    .input(z.object({ count: z.number().int().min(0) }))
    .mutation(({ ctx, input }) => setStreak(ctx.db, ctx.userId, input.count)),

  /** Wipe guided-session progress, unwinding its coins/bond (profile kept). */
  resetSessions: devProcedure.mutation(({ ctx }) => resetSessions(ctx.db, ctx.userId)),

  /** `resetSessions` plus the extracted fields/notes/astral. */
  resetProfile: devProcedure.mutation(({ ctx }) => resetProfile(ctx.db, ctx.userId)),

  /** Make today's daily box claimable again, reversing its coins/item. */
  resetDailyBox: devProcedure.mutation(({ ctx }) => resetDailyBox(ctx.db, ctx.userId)),

  /** Wipe the onboarding chat + goals so the funnel re-runs the guided-habit flow. */
  resetOnboarding: devProcedure.mutation(({ ctx }) => resetOnboarding(ctx.db, ctx.userId)),
});
