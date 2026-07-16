import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@sidekick/db";
import { protectedProcedure, router } from "../trpc";

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

/** Incremental funnel saves — a partial profile write from any onboarding step. */
const updateProfileInput = z.object({
  name: z.string().min(1).optional(),
  ageBracket: z.string().min(1).optional(),
  gender: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  sidekickName: z.string().min(1).optional(),
  sidekickColor: z.string().min(1).optional(),
  personality: personalitySchema.optional(),
});

/**
 * Profile read/write surface (07 stitch). `me` is server-authoritative for
 * first-launch routing: `onboardingComplete` reads `onboardingCompletedAt`,
 * which is set only by the funnel's completion transaction.
 */
export const usersRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        phone: users.phone,
        name: users.name,
        ageBracket: users.ageBracket,
        gender: users.gender,
        timezone: users.timezone,
        personality: users.personality,
        sidekickName: users.sidekickName,
        sidekickColor: users.sidekickColor,
        reminderTime: users.reminderTime,
        pushToken: users.pushToken,
        personalizedAdsConsent: users.personalizedAdsConsent,
        onboardingCompletedAt: users.onboardingCompletedAt,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    const user = rows[0];
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
    }
    return { ...user, onboardingComplete: user.onboardingCompletedAt !== null };
  }),

  updateProfile: protectedProcedure.input(updateProfileInput).mutation(async ({ ctx, input }) => {
    const patch: Partial<typeof users.$inferInsert> = { ...input, updatedAt: new Date() };
    if (input.ageBracket) {
      patch.ageGatePassed = true;
      patch.ageGatePassedAt = new Date();
      if (input.ageBracket === "under-18") {
        patch.personalizedAdsConsent = false;
      }
    }
    await ctx.db.update(users).set(patch).where(eq(users.id, ctx.userId));
    return { ok: true };
  }),
});
