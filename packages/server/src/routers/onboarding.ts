import { z } from "zod";
import { cadenceSchema } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { startHabitChat } from "../onboarding/chat";
import { commitOnboardingResult } from "../onboarding/commit-result";

/**
 * Onboarding is the streamlined scripted flow: the client walks the steps + intro
 * chat, then commits everything through `commitResult` (profile, completion flag,
 * the habit goal, and seed memories). `startHabitChat` is the separate goal-screen
 * "+" LLM flow (kind 'habit').
 */
export const onboardingRouter = router({
  /** Open a fresh guided habit-add chat (goal-screen "+"): kind 'habit'. */
  startHabitChat: protectedProcedure.mutation(({ ctx }) =>
    startHabitChat(ctx.db, ctx.model, ctx.userId),
  ),

  /**
   * The scripted onboarding's single completion write: profile + onboardingCompletedAt
   * + identity memory, the habit as a Goals object, and (talk path) a check-in
   * preference memory. Idempotent per user.
   */
  commitResult: protectedProcedure
    .input(
      z.object({
        reason: z.enum(["talk", "habits", "both"]),
        profile: z.object({
          name: z.string().min(1),
          gender: z.string().optional(),
          birthday: z.string().optional(),
          sidekickName: z.string().optional(),
          sidekickColor: z.string().optional(),
        }),
        habit: z
          .object({
            slug: z.string().min(1),
            label: z.string().min(1),
            actionLabel: z.string().min(1),
            cadence: cadenceSchema,
          })
          .optional(),
        talk: z.object({ topic: z.string().min(1) }).optional(),
        reminderTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => commitOnboardingResult(ctx.db, ctx.userId, input)),
});
