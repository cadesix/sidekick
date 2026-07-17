import { and, desc, eq } from "drizzle-orm";
import { actionItems, checkIns, goals, progressEvents } from "@sidekick/db";
import type { Database } from "@sidekick/db";
import { bumpMemoryVersion } from "../users";

/** The outcomes a progress event can record (03/07). */
export type CheckInOutcome = "hit" | "missed" | "partial" | "skipped";

/**
 * How a day's progress was recorded: the chat `log_checkin` tool infers it from
 * the conversation, the GoalsSheet's weekly toggle sets it by hand (plan 20
 * decision 8). Both write identical `progress_events` rows so the read paths
 * (goals.list/detail) and streak derivation can't tell them apart.
 */
export type CheckInSource = "inferred" | "manual";

/** The goal's most recent active action item, scoped to its owner. */
export async function activeActionItem(db: Database, userId: string, goalId: string) {
  const rows = await db
    .select({
      id: actionItems.id,
      cadence: actionItems.cadence,
      label: actionItems.label,
    })
    .from(actionItems)
    .innerJoin(goals, eq(actionItems.goalId, goals.id))
    .where(
      and(
        eq(actionItems.goalId, goalId),
        eq(goals.userId, userId),
        eq(actionItems.status, "active"),
      ),
    )
    .orderBy(desc(actionItems.createdAt))
    .limit(1);
  return rows[0];
}

export type LogGoalProgressResult =
  | { ok: false; error: string }
  | { ok: true; actionItemId: string; outcome: CheckInOutcome | null };

/**
 * The one write path both the chat `log_checkin` tool and the GoalsSheet's
 * manual toggle share (plan 20 decision 8). Upserts a single day's progress for
 * a goal's active action item, keyed by `(actionItemId, date)` so a re-log
 * overwrites the day rather than duplicating it. `outcome: null` clears the day
 * — the toggle-off round-trip, after which the read paths show it un-hit again.
 * Links today's check-in row when one exists (never creating one, matching the
 * chat path), and bumps the memory version so the sidekick's context reflects
 * the change.
 */
export async function logGoalProgress(
  db: Database,
  userId: string,
  input: {
    goalId: string;
    date: string;
    outcome: CheckInOutcome | null;
    note?: string | null;
    source: CheckInSource;
  },
): Promise<LogGoalProgressResult> {
  const item = await activeActionItem(db, userId, input.goalId);
  if (!item) {
    return { ok: false, error: "no active action item for that goal" };
  }

  const checkInRows = await db
    .select({ id: checkIns.id })
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), eq(checkIns.date, input.date)))
    .limit(1);
  const checkInId = checkInRows[0]?.id ?? null;

  const existing = await db
    .select({ id: progressEvents.id })
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, item.id), eq(progressEvents.date, input.date)))
    .limit(1);

  if (input.outcome === null) {
    if (existing[0]) {
      await db.delete(progressEvents).where(eq(progressEvents.id, existing[0].id));
    }
  } else if (existing[0]) {
    await db
      .update(progressEvents)
      .set({ outcome: input.outcome, note: input.note ?? null, checkInId, source: input.source })
      .where(eq(progressEvents.id, existing[0].id));
  } else {
    await db.insert(progressEvents).values({
      actionItemId: item.id,
      checkInId,
      date: input.date,
      outcome: input.outcome,
      note: input.note ?? null,
      source: input.source,
    });
  }

  await bumpMemoryVersion(db, userId);
  return { ok: true, actionItemId: item.id, outcome: input.outcome };
}
