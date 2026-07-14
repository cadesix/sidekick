import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { type Database, actionItems, goals, healthDays, progressEvents } from "@sidekick/db";
import type { HealthDayInput } from "@sidekick/shared";
import { bumpMemoryVersion } from "../memory/store";
import { autoLogHealthDay } from "./auto-log";

function toDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Upsert a batch of on-device health days (12 §sync) and run device-verified goal
 * logging over them. The client posts the trailing week on app foreground; the
 * per-day aggregate is already merged across sources on-device (Watch preferred),
 * so the server just stores it verbatim, last-write-wins on (user, date). Bumps
 * `memory_version` when anything changed so the client refetches and the prompt
 * cache re-renders.
 */
export async function syncHealthDays(
  db: Database,
  userId: string,
  days: HealthDayInput[],
): Promise<{ synced: number; logged: number }> {
  if (days.length === 0) {
    return { synced: 0, logged: 0 };
  }

  let logged = 0;
  for (const day of days) {
    const sleepStart = toDate(day.sleepStart);
    const values = {
      userId,
      date: day.date,
      steps: day.steps ?? null,
      activeCalories: day.activeCalories ?? null,
      sleepMinutes: day.sleepMinutes ?? null,
      sleepStart,
      sleepEnd: toDate(day.sleepEnd),
      workouts: day.workouts,
      syncedAt: new Date(),
    };
    await db
      .insert(healthDays)
      .values(values)
      .onConflictDoUpdate({ target: [healthDays.userId, healthDays.date], set: values });

    const result = await autoLogHealthDay(db, userId, {
      date: day.date,
      sleepStart,
      workouts: day.workouts,
    });
    logged += result.logged;
  }

  const newestDate = [...days].sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  if (newestDate) {
    const cutoff = new Date(`${newestDate}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 29);
    await db
      .delete(healthDays)
      .where(
        and(
          eq(healthDays.userId, userId),
          lt(healthDays.date, cutoff.toISOString().slice(0, 10)),
        ),
      );
  }

  await bumpMemoryVersion(db, userId);
  return { synced: days.length, logged };
}

/** Whether the user has ever synced, and when they last did — for the settings sheet. */
export async function healthStatus(
  db: Database,
  userId: string,
): Promise<{ connected: boolean; lastSyncedAt: Date | null }> {
  const rows = await db
    .select({ syncedAt: healthDays.syncedAt })
    .from(healthDays)
    .where(eq(healthDays.userId, userId))
    .orderBy(desc(healthDays.syncedAt))
    .limit(1);
  const last = rows[0]?.syncedAt ?? null;
  return { connected: last !== null, lastSyncedAt: last };
}

/** Disconnect cascade (12 §settings): delete every synced day server-side. */
export async function disconnectHealth(db: Database, userId: string): Promise<{ deleted: number }> {
  const deleted = await db
    .delete(healthDays)
    .where(and(eq(healthDays.userId, userId)))
    .returning({ id: healthDays.id });
  const items = await db
    .select({ id: actionItems.id })
    .from(actionItems)
    .innerJoin(goals, eq(actionItems.goalId, goals.id))
    .where(eq(goals.userId, userId));
  if (items.length > 0) {
    await db
      .delete(progressEvents)
      .where(
        and(
          inArray(progressEvents.actionItemId, items.map((item) => item.id)),
          eq(progressEvents.source, "device"),
        ),
      );
  }
  await bumpMemoryVersion(db, userId);
  return { deleted: deleted.length };
}
