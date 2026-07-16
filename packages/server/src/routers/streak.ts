import { protectedProcedure, router } from "../trpc";
import { touchStreak } from "../rewards/streak";

/**
 * The app-open streak (plan 20 decision 7). `touch` is fired from the client's
 * foreground hook, idempotent per local day — see `touchStreak` for the
 * transition rules and the concurrency guarantee.
 */
export const streakRouter = router({
  touch: protectedProcedure.mutation(({ ctx }) => touchStreak(ctx.db, ctx.userId)),
});
