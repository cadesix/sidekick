import { and, eq, inArray } from "drizzle-orm";
import { type Database, healthDays } from "@sidekick/db";
import { addDays, localDate } from "../goals/dates";
import { healthWorkoutSchema } from "../health/types";

type HealthRow = {
  date: string;
  steps: number | null;
  activeCalories: number | null;
  sleepMinutes: number | null;
  sleepStart: Date | null;
  sleepEnd: Date | null;
  workouts: unknown;
};

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
  if (row.activeCalories !== null && row.activeCalories > 0) {
    parts.push(`${row.activeCalories.toLocaleString("en-US")} active calories`);
  }
  parts.push(...workoutPhrases(row.workouts));
  if (parts.length === 0) {
    return null;
  }
  return `- connected Apple Health summary: ${label}: ${parts.join(", ")}`;
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
  timezone: string,
): Promise<string[]> {
  const today = localDate(timezone, now);
  const yesterday = addDays(today, -1);

  const rows = await db
    .select({
      date: healthDays.date,
      steps: healthDays.steps,
      activeCalories: healthDays.activeCalories,
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
