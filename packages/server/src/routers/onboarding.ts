import { z } from "zod";
import { cadenceSchema } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { generateHabitAck, regulateHabitAction, startHabitChat } from "../onboarding/chat";
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

  /** A personalized ack line for the home speech bubble after a "+" habit is set. */
  habitAck: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      generateHabitAck(ctx.db, ctx.captionModel, ctx.userId, input.conversationId),
    ),

  /**
   * Regulate a freeform onboarding action into a daily checkpoint (scripted
   * intro chat's "which feels doable?" step, when the user types their own).
   * Returns `{ ok: true, action }` (normalized) or `{ ok: false, nudge }`.
   */
  regulateAction: protectedProcedure
    .input(z.object({ improve: z.string().min(1), text: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) =>
      regulateHabitAction(ctx.captionModel, input.improve, input.text),
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
