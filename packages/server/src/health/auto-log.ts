import { and, eq } from "drizzle-orm";
import { type Database, actionItems, checkIns, goals, progressEvents, users } from "@sidekick/db";
import { type HealthWorkout, healthWorkoutSchema, userTimezone } from "@sidekick/shared";

/**
 * Which fitness action items a workout type satisfies. Unknown types still count
 * as a generic gym session — movement happened. Keyed on a letters-only normalize
 * of HealthKit's `HKWorkoutActivityType` name.
 */
const WORKOUT_SLUGS: Record<string, string[]> = {
  running: ["run", "gym"],
  run: ["run", "gym"],
  walking: ["walk"],
  hiking: ["walk"],
  cycling: ["gym"],
  yoga: ["yoga", "gym"],
  traditionalstrengthtraining: ["strength", "gym"],
  functionalstrengthtraining: ["strength", "gym"],
  strengthtraining: ["strength", "gym"],
  strength: ["strength", "gym"],
  highintensityintervaltraining: ["gym"],
  coretraining: ["gym"],
};

function slugsForWorkout(type: string): string[] {
  const key = type.toLowerCase().replace(/[^a-z]/g, "");
  return WORKOUT_SLUGS[key] ?? ["gym"];
}

/**
 * Minutes-into-the-evening of a wall time, so bedtimes that cross midnight compare
 * correctly (00:48 is *later* than 23:30, not earlier). Times before noon are
 * treated as the next day.
 */
function eveningMinutes(hour: number, minute: number): number {
  const base = hour * 60 + minute;
  return hour < 12 ? base + 24 * 60 : base;
}

function localWallMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return eveningMinutes(hour, minute);
}

function targetMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return eveningMinutes(Number(match[1]), Number(match[2]));
}

type Cadence = { type?: string; criteria?: string; value?: string };

function readCadence(value: unknown): Cadence {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    type: typeof record.type === "string" ? record.type : undefined,
    criteria: typeof record.criteria === "string" ? record.criteria : undefined,
    value: typeof record.value === "string" ? record.value : undefined,
  };
}

/**
 * Write a device-verified progress event, respecting source precedence
 * (12 / 03): only insert when nothing exists for (item, date), or update when the
 * existing event is *itself* device-sourced. It never overwrites `inferred`
 * (log_checkin), `user_stated`, or `manual` — the user's word always outranks the
 * sensor. Returns whether it wrote.
 */
async function logDeviceProgress(
  db: Database,
  actionItemId: string,
  date: string,
  outcome: string,
  checkInId: string | null,
): Promise<boolean> {
  const existing = await db
    .select({ id: progressEvents.id, source: progressEvents.source })
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, actionItemId), eq(progressEvents.date, date)))
    .limit(1);
  const row = existing[0];
  if (!row) {
    await db.insert(progressEvents).values({
      actionItemId,
      checkInId,
      date,
      outcome,
      source: "device",
    });
    return true;
  }
  if (row.source !== "device") {
    return false;
  }
  await db.update(progressEvents).set({ outcome, checkInId }).where(eq(progressEvents.id, row.id));
  return true;
}

type ActiveItem = { id: string; slug: string; cadence: unknown };

type SyncedDay = {
  date: string;
  sleepStart: Date | null;
  workouts: unknown;
};

function parseWorkouts(value: unknown): HealthWorkout[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed: HealthWorkout[] = [];
  for (const raw of value) {
    const result = healthWorkoutSchema.safeParse(raw);
    if (result.success) {
      parsed.push(result.data);
    }
  }
  return parsed;
}

/**
 * Turn one synced day into device-verified progress (12 §device-verified goals):
 * a workout matching an active fitness action item logs it; a `sleepStart` before
 * the sleep goal's target time logs the sleep item. The sidekick reacts to these
 * naturally on the next turn, never announcing that anything was logged (03's
 * silence rule).
 */
export async function autoLogHealthDay(
  db: Database,
  userId: string,
  day: SyncedDay,
): Promise<{ logged: number }> {
  const items: ActiveItem[] = await db
    .select({ id: actionItems.id, slug: actionItems.slug, cadence: actionItems.cadence })
    .from(actionItems)
    .innerJoin(goals, eq(actionItems.goalId, goals.id))
    .where(
      and(eq(goals.userId, userId), eq(goals.status, "active"), eq(actionItems.status, "active")),
    );
  if (items.length === 0) {
    return { logged: 0 };
  }

  const checkInRows = await db
    .select({ id: checkIns.id })
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), eq(checkIns.date, day.date)))
    .limit(1);
  const checkInId = checkInRows[0]?.id ?? null;

  let logged = 0;

  const satisfiedSlugs = new Set<string>();
  for (const workout of parseWorkouts(day.workouts)) {
    for (const slug of slugsForWorkout(workout.type)) {
      satisfiedSlugs.add(slug);
    }
  }
  for (const item of items) {
    if (satisfiedSlugs.has(item.slug)) {
      const wrote = await logDeviceProgress(db, item.id, day.date, "hit", checkInId);
      logged += wrote ? 1 : 0;
    }
  }

  if (day.sleepStart) {
    const timezone = await userTimezone(db, userId);
    const started = localWallMinutes(day.sleepStart, timezone);
    for (const item of items) {
      const cadence = readCadence(item.cadence);
      if (cadence.type !== "daily-criteria" || cadence.criteria !== "asleep-by") {
        continue;
      }
      const target = targetMinutes(cadence.value ?? "");
      if (target === null) {
        continue;
      }
      const outcome = started <= target ? "hit" : "missed";
      const wrote = await logDeviceProgress(db, item.id, day.date, outcome, checkInId);
      logged += wrote ? 1 : 0;
    }
  }

  return { logged };
}
