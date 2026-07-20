import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { actionItems, type Database, goals, memories, users } from "@sidekick/db";
import { bumpMemoryVersion, type Cadence, CUSTOM_ACTION_SLUG } from "@sidekick/shared";
import { agePhrase, goalContextSentence } from "./seed";

// Default daily check-in time when the streamlined onboarding didn't ask for one.
const DEFAULT_CHECKIN_TIME = "19:00";

export type CommitOnboardingResultInput = {
  reason: "talk" | "habits" | "both";
  // collected in the pre-chat steps; drives profile persistence + the identity memory
  profile: {
    name: string;
    gender?: string;
    birthday?: string; // "YYYY-MM-DD"
    sidekickName?: string;
    sidekickColor?: string;
  };
  // habit path → a Goals-interface object (goal + one daily action item)
  habit?: { slug: string; label: string; actionLabel: string; cadence: Cadence };
  // talk path → seeded as a preference memory (drives daily check-ins), no goal card
  talk?: { topic: string };
  reminderTime?: string;
};

// "YYYY-MM-DD" → an age bracket matching seed.ts's AGE_PHRASE keys.
function ageBracketFromBirthday(birthday: string, today: Date): string | null {
  const [y, m, d] = birthday.split("-").map(Number);
  if (!y || !m || !d) return null;
  let age = today.getFullYear() - y;
  const monthNow = today.getMonth() + 1;
  if (monthNow < m || (monthNow === m && today.getDate() < d)) age -= 1;
  if (age < 0 || age > 120) return null;
  if (age < 18) return "under-18";
  if (age <= 24) return "18-24";
  if (age <= 34) return "25-34";
  if (age <= 44) return "35-44";
  if (age <= 54) return "45-54";
  return "55-plus";
}

// The scripted step's gender values ("woman"/"man"/"non-binary"/"prefer not to
// say") read naturally as-is; omit the non-answer.
function identitySentence(name: string, ageBracket: string | null, gender?: string): string {
  const genderWord = (gender ?? "").toLowerCase();
  const parts = [
    ageBracket ? agePhrase(ageBracket) : "",
    genderWord && genderWord !== "prefer not to say" ? genderWord : "",
  ].filter(Boolean);
  return parts.length > 0 ? `${name} is ${parts.join(", ")}.` : `${name} just joined.`;
}

/**
 * The streamlined onboarding's single completion write (replaces the old funnel
 * `completeOnboarding`). Fills the `users` profile, marks `onboardingCompletedAt`,
 * makes the habit a real goal + action item (so it shows in the Goals sheet), and
 * seeds onboarding memories (identity always; goal_context for a habit; a talk
 * preference). Idempotent: `onboardingCompletedAt` short-circuits a re-run so a
 * replay never duplicates goals or memories.
 */
export async function commitOnboardingResult(
  db: Database,
  userId: string,
  input: CommitOnboardingResultInput,
): Promise<{ ok: true; alreadyComplete: boolean }> {
  const rows = await db
    .select({ onboardingCompletedAt: users.onboardingCompletedAt, reminderTime: users.reminderTime })
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

  const now = new Date();
  const name = input.profile.name.trim() || "there";
  const ageBracket = input.profile.birthday ? ageBracketFromBirthday(input.profile.birthday, now) : null;

  const patch: Partial<typeof users.$inferInsert> = {
    name: input.profile.name || null,
    gender: input.profile.gender || null,
    ageBracket: ageBracket ?? null,
    sidekickName: input.profile.sidekickName || null,
    reminderTime: existing.reminderTime ?? input.reminderTime ?? DEFAULT_CHECKIN_TIME,
    ageGatePassed: true,
    ageGatePassedAt: now,
    onboardingCompletedAt: now,
    updatedAt: now,
  };
  if (input.profile.sidekickColor) {
    patch.sidekickColor = input.profile.sidekickColor;
  }
  if (ageBracket === "under-18") {
    patch.personalizedAdsConsent = false;
  }
  await db.update(users).set(patch).where(eq(users.id, userId));

  const memoryRows: (typeof memories.$inferInsert)[] = [
    {
      userId,
      kind: "identity",
      content: identitySentence(name, ageBracket, input.profile.gender),
      confidence: "stated",
      source: "onboarding",
    },
  ];

  if (input.habit) {
    const { slug, label, actionLabel, cadence } = input.habit;
    // dedup by active slug: a re-commit of the same habit updates it in place
    const existingGoal = await db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.slug, slug), eq(goals.status, "active")))
      .limit(1);
    let goalId = existingGoal[0]?.id;
    if (!goalId) {
      const inserted = await db
        .insert(goals)
        .values({ userId, slug, label, status: "active" })
        .returning({ id: goals.id });
      goalId = inserted[0]?.id;
    } else {
      await db.update(goals).set({ label, updatedAt: now }).where(eq(goals.id, goalId));
    }
    if (goalId) {
      const currentItem = await db
        .select({ id: actionItems.id })
        .from(actionItems)
        .where(and(eq(actionItems.goalId, goalId), eq(actionItems.status, "active")))
        .orderBy(desc(actionItems.createdAt))
        .limit(1);
      if (currentItem[0]) {
        await db
          .update(actionItems)
          .set({ slug: CUSTOM_ACTION_SLUG, label: actionLabel, cadence })
          .where(eq(actionItems.id, currentItem[0].id));
      } else {
        await db
          .insert(actionItems)
          .values({ goalId, slug: CUSTOM_ACTION_SLUG, label: actionLabel, cadence, status: "active" });
      }
    }
    memoryRows.push({
      userId,
      kind: "goal_context",
      content: goalContextSentence(name, label, actionLabel, cadence),
      confidence: "stated",
      source: "onboarding",
    });
  }

  if (input.talk) {
    memoryRows.push({
      userId,
      kind: "preference",
      content: `Wants to talk about ${input.talk.topic}.`,
      confidence: "stated",
      source: "onboarding",
    });
  }

  await db.insert(memories).values(memoryRows);
  await bumpMemoryVersion(db, userId);

  return { ok: true, alreadyComplete: false };
}
