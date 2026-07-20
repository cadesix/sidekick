import { and, desc, eq } from "drizzle-orm";
import { actionItems, type Database, goals, memories, users } from "@sidekick/db";
import { bumpMemoryVersion, type Cadence, CUSTOM_ACTION_SLUG } from "@sidekick/shared";

// Default daily check-in time when the streamlined onboarding didn't ask for one.
const DEFAULT_CHECKIN_TIME = "19:00";

export type CommitOnboardingResultInput = {
  reason: "talk" | "habits" | "both";
  // habit path → a Goals-interface object (goal + one daily action item)
  habit?: { slug: string; label: string; actionLabel: string; cadence: Cadence };
  // talk path → seeded as a preference memory (drives daily check-ins), no goal card
  talk?: { topic: string };
  reminderTime?: string;
};

/**
 * Persist what the streamlined onboarding intro chat collected. Habits become real
 * `goals` + `actionItems` rows (so they show up in the Goals sheet, which reads
 * `goals.list`); the talk path is stored as a preference memory to seed the daily
 * check-ins. Idempotent per active goal slug so a retry/replay never duplicates.
 */
export async function commitOnboardingResult(
  db: Database,
  userId: string,
  input: CommitOnboardingResultInput,
): Promise<{ ok: true }> {
  if (input.habit) {
    const { slug, label, actionLabel, cadence } = input.habit;
    // dedup by active slug: a re-commit of the same habit updates it in place
    const existing = await db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.slug, slug), eq(goals.status, "active")))
      .limit(1);
    let goalId = existing[0]?.id;
    if (!goalId) {
      const inserted = await db
        .insert(goals)
        .values({ userId, slug, label, status: "active" })
        .returning({ id: goals.id });
      goalId = inserted[0]?.id;
    } else {
      await db.update(goals).set({ label, updatedAt: new Date() }).where(eq(goals.id, goalId));
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
  }

  if (input.talk) {
    await db.insert(memories).values({
      userId,
      kind: "preference",
      content: `Wants to talk about ${input.talk.topic}.`,
      confidence: "stated",
      source: "onboarding",
    });
    await bumpMemoryVersion(db, userId);
  }

  // seed a daily check-in time if the user doesn't already have one
  const rows = await db
    .select({ reminderTime: users.reminderTime })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (rows[0] && !rows[0].reminderTime) {
    await db
      .update(users)
      .set({ reminderTime: input.reminderTime ?? DEFAULT_CHECKIN_TIME, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  return { ok: true };
}
