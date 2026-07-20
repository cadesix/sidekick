import { z } from "zod";
import { cadenceSchema, ianaTimezone } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { startHabitChat, startOnboardingChat } from "../onboarding/chat";
import { commitOnboardingResult } from "../onboarding/commit-result";
import { completeOnboarding } from "../onboarding/complete";

const personalitySchema = z.object({
  archetype: z.string(),
  tagline: z.string(),
  blurb: z.string(),
  percents: z.object({
    O: z.number(),
    C: z.number(),
    E: z.number(),
    A: z.number(),
    N: z.number(),
  }),
});

const goalPlanSchema = z.object({
  slug: z.string().min(1),
  actionSlug: z.string().min(1).optional(),
  cadence: cadenceSchema.optional(),
  label: z.string().min(1).optional(),
});

const completeInput = z.object({
  name: z.string().min(1),
  ageBracket: z.string().min(1),
  gender: z.string().min(1),
  personality: personalitySchema,
  sidekickName: z.string().min(1),
  sidekickColor: z.string().min(1),
  timezone: ianaTimezone,
  reminderTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  pushToken: z.string().optional(),
  interests: z.array(z.string().min(1)).optional(),
  goals: z.array(goalPlanSchema).min(1),
});

/**
 * Funnel completion — the last onboarding step commits everything here (02 §
 * cold start). See `completeOnboarding` for the seed transaction and idempotency.
 * `startChat` opens the LLM-driven onboarding chat (kind 'onboarding'); the
 * scripted client flow is the fallback when it fails.
 */
export const onboardingRouter = router({
  startChat: protectedProcedure
    // Empty = the freeform first-habit flow (no catalog goal chosen); the chat
    // discovers and commits the habit itself.
    .input(z.object({ goalSlugs: z.array(z.string().min(1)) }))
    .mutation(({ ctx, input }) =>
      startOnboardingChat(ctx.db, ctx.model, ctx.userId, input.goalSlugs),
    ),

  /** Open a fresh guided habit-add chat (goal-screen "+"): kind 'habit'. */
  startHabitChat: protectedProcedure.mutation(({ ctx }) =>
    startHabitChat(ctx.db, ctx.model, ctx.userId),
  ),

  complete: protectedProcedure
    .input(completeInput)
    .mutation(({ ctx, input }) => completeOnboarding(ctx.db, ctx.userId, input)),

  /**
   * Persist what the streamlined intro chat collected: habit picks become Goals
   * objects; the talk path seeds a check-in preference memory. Separate from
   * `complete` (which also seeds personality/identity from the full funnel).
   */
  commitResult: protectedProcedure
    .input(
      z.object({
        reason: z.enum(["talk", "habits", "both"]),
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
