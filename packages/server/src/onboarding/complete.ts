import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { type Database, memories, users } from "@sidekick/db";
import { type Cadence, DEFAULT_REMINDER_TIME } from "@sidekick/shared";
import { bumpMemoryVersion } from "../memory/store";
import { ensureGoalPlan } from "./adopt";
import {
  goalContextSentence,
  identitySentence,
  interestsSentence,
  type OnboardingPersonality,
  preferenceSentence,
} from "./seed";

export type CompleteGoalInput = {
  slug: string;
  actionSlug?: string;
  cadence?: Cadence;
  label?: string;
};

export type CompleteOnboardingInput = {
  name: string;
  ageBracket: string;
  gender: string;
  personality: OnboardingPersonality;
  sidekickName: string;
  sidekickColor: string;
  timezone: string;
  /** Omitted when the onboarding chat already stored one via `set_reminder_time`. */
  reminderTime?: string;
  pushToken?: string;
  interests?: string[];
  goals: CompleteGoalInput[];
};

export type CompleteOnboardingResult = { ok: true; alreadyComplete: boolean };

/**
 * The funnel's cold-start seed (user-memory.md §6). One idempotent write: fill the
 * `users` profile, make sure every chosen goal is fully planned (plans the LLM
 * onboarding chat already committed are kept as-is — see `ensureGoalPlan`), and
 * seed onboarding memories (identity + preference + interests + one goal_context
 * per goal). `onboardingCompletedAt` is the completion marker — set only here, so
 * a re-run short-circuits and never duplicates goals or memories. Age gate (plan
 * 00): `under-18` turns off personalized-ads consent; every bracket records the
 * gate as passed.
 */
export async function completeOnboarding(
  db: Database,
  userId: string,
  input: CompleteOnboardingInput,
): Promise<CompleteOnboardingResult> {
  const rows = await db
    .select({
      onboardingCompletedAt: users.onboardingCompletedAt,
      reminderTime: users.reminderTime,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
  }
  if (existing.onboardingCompletedAt !== null) {
    return { ok: true, alreadyComplete: true };
  }

  const underage = input.ageBracket === "under-18";
  const patch: Partial<typeof users.$inferInsert> = {
    name: input.name,
    ageBracket: input.ageBracket,
    gender: input.gender,
    personality: input.personality,
    sidekickName: input.sidekickName,
    sidekickColor: input.sidekickColor,
    timezone: input.timezone,
    reminderTime: input.reminderTime ?? existing.reminderTime ?? DEFAULT_REMINDER_TIME,
    pushToken: input.pushToken ?? null,
    ageGatePassed: true,
    ageGatePassedAt: new Date(),
    onboardingCompletedAt: new Date(),
    updatedAt: new Date(),
  };
  if (underage) {
    patch.personalizedAdsConsent = false;
  }
  await db.update(users).set(patch).where(eq(users.id, userId));

  const goalMemories: string[] = [];
  for (const goalInput of input.goals) {
    const plan = await ensureGoalPlan(db, userId, goalInput);
    goalMemories.push(goalContextSentence(input.name, plan.label, plan.actionLabel, plan.cadence));
  }

  const seedRows: (typeof memories.$inferInsert)[] = [
    {
      userId,
      kind: "identity",
      content: identitySentence(input.name, input.ageBracket, input.gender),
      confidence: "stated",
      source: "onboarding",
    },
    {
      userId,
      kind: "preference",
      content: preferenceSentence(input.name, input.personality),
      confidence: "stated",
      source: "onboarding",
    },
    ...(input.interests && input.interests.length > 0
      ? [
          {
            userId,
            kind: "interest",
            content: interestsSentence(input.name, input.interests),
            confidence: "stated",
            source: "onboarding",
          } satisfies typeof memories.$inferInsert,
        ]
      : []),
    ...goalMemories.map((content): typeof memories.$inferInsert => ({
      userId,
      kind: "goal_context",
      content,
      confidence: "stated",
      source: "onboarding",
    })),
  ];
  await db.insert(memories).values(seedRows);
  await bumpMemoryVersion(db, userId);

  return { ok: true, alreadyComplete: false };
}
