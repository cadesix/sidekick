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

// "YYYY-MM-DD" → an age bracket matching seed.ts's AGE_PHRASE keys. Rejects
// out-of-range / impossible dates so a bad birthday never yields a bogus bracket.
function ageBracketFromBirthday(birthday: string, today: Date): string | null {
  const [y, m, d] = birthday.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // reject impossible calendar dates (e.g. Feb 31, which would roll over)
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
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

// The scripted step's labels → the canonical gender values the rest of the app
// expects (pronounsFor, ad projection): female/male/non-binary/prefer-not.
const GENDER_CANON: Record<string, string> = {
  woman: "female",
  man: "male",
  "non-binary": "non-binary",
  "prefer not to say": "prefer-not",
};
function canonicalGender(gender?: string): string | null {
  const raw = (gender ?? "").trim().toLowerCase();
  if (!raw) return null;
  return GENDER_CANON[raw] ?? raw;
}

// Canonical gender ("female"/"male"/"non-binary"); the non-answer is omitted.
function identitySentence(name: string, ageBracket: string | null, gender: string | null): string {
  const parts = [
    ageBracket ? agePhrase(ageBracket) : "",
    gender && gender !== "prefer-not" ? gender : "",
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
  // One atomic transaction: either the whole completion lands (profile flag +
  // goal + memories) or none of it, so a mid-way failure can't leave a "complete"
  // user with no seed data that a retry would then skip. FOR UPDATE serializes
  // concurrent finish calls (the second blocks, then sees the flag set).
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ onboardingCompletedAt: users.onboardingCompletedAt, reminderTime: users.reminderTime })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    const existing = rows[0];
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "user not found" });
    }
    if (existing.onboardingCompletedAt !== null) {
      return { ok: true as const, alreadyComplete: true };
    }

    const now = new Date();
    const name = input.profile.name.trim() || "there";
    const gender = canonicalGender(input.profile.gender);
    const ageBracket = input.profile.birthday
      ? ageBracketFromBirthday(input.profile.birthday, now)
      : null;

    const patch: Partial<typeof users.$inferInsert> = {
      name: input.profile.name || null,
      gender,
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
    await tx.update(users).set(patch).where(eq(users.id, userId));

    const memoryRows: (typeof memories.$inferInsert)[] = [
      {
        userId,
        kind: "identity",
        content: identitySentence(name, ageBracket, gender),
        confidence: "stated",
        source: "onboarding",
      },
    ];

    if (input.habit) {
      const { slug, label, actionLabel, cadence } = input.habit;
      // dedup by active slug: a re-commit of the same habit updates it in place
      const existingGoal = await tx
        .select({ id: goals.id })
        .from(goals)
        .where(and(eq(goals.userId, userId), eq(goals.slug, slug), eq(goals.status, "active")))
        .limit(1);
      let goalId = existingGoal[0]?.id;
      if (!goalId) {
        const inserted = await tx
          .insert(goals)
          .values({ userId, slug, label, status: "active" })
          .returning({ id: goals.id });
        goalId = inserted[0]?.id;
      } else {
        await tx.update(goals).set({ label, updatedAt: now }).where(eq(goals.id, goalId));
      }
      if (goalId) {
        const currentItem = await tx
          .select({ id: actionItems.id })
          .from(actionItems)
          .where(and(eq(actionItems.goalId, goalId), eq(actionItems.status, "active")))
          .orderBy(desc(actionItems.createdAt))
          .limit(1);
        if (currentItem[0]) {
          await tx
            .update(actionItems)
            .set({ slug: CUSTOM_ACTION_SLUG, label: actionLabel, cadence })
            .where(eq(actionItems.id, currentItem[0].id));
        } else {
          await tx
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

    await tx.insert(memories).values(memoryRows);
    await bumpMemoryVersion(tx, userId);

    return { ok: true as const, alreadyComplete: false };
  });
}
