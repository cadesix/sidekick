import { and, eq, inArray } from "drizzle-orm";
import { type Database, healthDays, users } from "@sidekick/db";
import { healthWorkoutSchema } from "../health/types";
import { localCalendarDate } from "./dates";

type HealthRow = {
  date: string;
  steps: number | null;
  activeCalories: number | null;
  restingHr: number | null;
  sleepMinutes: number | null;
  sleepStart: Date | null;
  sleepEnd: Date | null;
  workouts: unknown;
};

function localDateString(now: Date, timezone: string, offsetDays: number): string {
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  const { year, month, day } = localCalendarDate(shifted, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "12:48" — local wall-clock hour:minute, no am/pm (12 §render). */
function clockTime(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  return `${hour}:${minute}`;
}

function sleepDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) {
    return `${mins}m`;
  }
  return `${hours}h${String(mins).padStart(2, "0")}m`;
}

function workoutPhrases(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const phrases: string[] = [];
  for (const raw of value) {
    const parsed = healthWorkoutSchema.safeParse(raw);
    if (parsed.success) {
      phrases.push(`${Math.round(parsed.data.minutes)}-min ${parsed.data.type}`);
    }
  }
  return phrases;
}

function renderRow(row: HealthRow, label: string, timezone: string): string | null {
  const parts: string[] = [];
  if (row.steps !== null && row.steps > 0) {
    parts.push(`${row.steps.toLocaleString("en-US")} steps`);
  }
  if (row.sleepMinutes !== null && row.sleepMinutes > 0) {
    const window =
      row.sleepStart && row.sleepEnd
        ? ` (${clockTime(row.sleepStart, timezone)}–${clockTime(row.sleepEnd, timezone)})`
        : "";
    parts.push(`${sleepDuration(row.sleepMinutes)} sleep${window}`);
  }
  parts.push(...workoutPhrases(row.workouts));
  if (row.restingHr !== null && row.restingHr > 0) {
    parts.push(`resting hr ${row.restingHr}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `- ${label}: ${parts.join(", ")}`;
}

/**
 * The health lines for the memory block's RECENT section (12 §sync): yesterday
 * and today's on-device aggregate, rendered like a friend would recap it
 * ("yesterday: 11,204 steps, 6h41m sleep (12:48–7:29), 34-min run"). Read-only,
 * off the hot path — no tool round-trip. Returns `[]` when there's nothing synced,
 * so the call site adds no empty section.
 */
export async function renderHealthLines(
  db: Database,
  userId: string,
  now: Date,
): Promise<string[]> {
  const userRows = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const timezone = userRows[0]?.timezone;
  if (!timezone) {
    return [];
  }

  const today = localDateString(now, timezone, 0);
  const yesterday = localDateString(now, timezone, -1);

  const rows = await db
    .select({
      date: healthDays.date,
      steps: healthDays.steps,
      activeCalories: healthDays.activeCalories,
      restingHr: healthDays.restingHr,
      sleepMinutes: healthDays.sleepMinutes,
      sleepStart: healthDays.sleepStart,
      sleepEnd: healthDays.sleepEnd,
      workouts: healthDays.workouts,
    })
    .from(healthDays)
    .where(and(eq(healthDays.userId, userId), inArray(healthDays.date, [yesterday, today])));

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const lines: string[] = [];
  const yesterdayRow = byDate.get(yesterday);
  if (yesterdayRow) {
    const line = renderRow(yesterdayRow, "yesterday", timezone);
    if (line) {
      lines.push(line);
    }
  }
  const todayRow = byDate.get(today);
  if (todayRow) {
    const line = renderRow(todayRow, "today", timezone);
    if (line) {
      lines.push(line);
    }
  }
  return lines;
}
