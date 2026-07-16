import { protectedProcedure, router } from "../trpc";
import { claimDailyBox, dailyBoxStatus } from "../rewards/daily-box";

/**
 * The daily box (plan 20 §dailyBox router). `status` previews today's box —
 * tier and milestone reflect the streak as-if-touched, matching what `claim`
 * (which touches in the same transaction) would grant. All semantics live in
 * `rewards/daily-box.ts`, shared with the state snapshot.
 */
export const dailyBoxRouter = router({
  status: protectedProcedure.query(({ ctx }) => dailyBoxStatus(ctx.db, ctx.userId)),
  claim: protectedProcedure.mutation(({ ctx }) => claimDailyBox(ctx.db, ctx.userId)),
});
