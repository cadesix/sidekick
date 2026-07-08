import { RRule } from "rrule";
import { z } from "zod";
import { localCalendarDate } from "../memory/dates";

/**
 * The reminder schedule model (10-reminders.md §data model). Two shapes:
 * - `once`:      a single wall-clock time in the user's timezone.
 * - `recurring`: an `rrule` recurrence for the *date* pattern plus a wall-clock
 *   `time`; the rrule owns the cadence (every weekday, first Monday, every 3
 *   days) so we never invent a cadence DSL.
 *
 * All times are the user's local wall clock. The UTC firing instant is derived
 * per-occurrence with `zonedWallTimeToUtc`, so a 07:30 reminder stays 07:30 for
 * the user across DST transitions (its UTC offset shifts, the wall clock doesn't).
 */
export const onceScheduleSchema = z.object({
  type: z.literal("once"),
  at: z.string().describe("local wall-clock time, 'YYYY-MM-DDTHH:mm'"),
});

export const recurringScheduleSchema = z.object({
  type: z.literal("recurring"),
  rrule: z.string().describe("rrule date pattern, e.g. 'FREQ=WEEKLY;BYDAY=MO,WE,FR'"),
  time: z.string().describe("local time of day, 'HH:mm'"),
});

export const scheduleSchema = z.discriminatedUnion("type", [
  onceScheduleSchema,
  recurringScheduleSchema,
]);

export type Schedule = z.infer<typeof scheduleSchema>;
export type OnceSchedule = z.infer<typeof onceScheduleSchema>;
export type RecurringSchedule = z.infer<typeof recurringScheduleSchema>;

/** Parse an unknown jsonb `schedule` column into a typed `Schedule`, or null. */
export function parseSchedule(value: unknown): Schedule | null {
  const result = scheduleSchema.safeParse(value);
  return result.success ? result.data : null;
}

type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

function toInt(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse "HH:mm" into hour/minute, clamping malformed input to 0. */
export function parseTimeOfDay(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(":");
  return { hour: toInt(hour), minute: toInt(minute) };
}

/** Parse "YYYY-MM-DDTHH:mm" (seconds optional) into wall-clock components. */
export function parseWallDateTime(at: string): WallTime {
  const [datePart, timePart] = at.split("T");
  const [year, month, day] = (datePart ?? "").split("-");
  const { hour, minute } = parseTimeOfDay(timePart ?? "00:00");
  return { year: toInt(year), month: toInt(month), day: toInt(day), hour, minute };
}

/** Render wall-clock components back to the stored "YYYY-MM-DDTHH:mm" form. */
export function formatWallDateTime(wall: WallTime): string {
  const pad = (n: number): string => `${n}`.padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** Milliseconds a timezone is ahead of UTC at a given instant. */
function tzOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number =>
    toInt(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * The UTC instant of a wall-clock time in an IANA timezone, DST-correct. Guesses
 * with the offset at the naive instant, then re-resolves at the candidate — the
 * two-pass technique that lands on the right side of a DST transition (used by
 * date-fns-tz). Gaps (spring-forward) and overlaps (fall-back) resolve to a valid
 * instant rather than throwing; a missed minute beats a crashed cron.
 */
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstOffset = tzOffsetMs(timeZone, new Date(naive));
  let instant = naive - firstOffset;
  const secondOffset = tzOffsetMs(timeZone, new Date(instant));
  if (secondOffset !== firstOffset) {
    instant = naive - secondOffset;
  }
  return new Date(instant);
}

/**
 * The next UTC instant a schedule should fire, strictly after `now`, or null if
 * the recurrence is exhausted. Pure and clock-injectable (10 / 03 testing rule).
 *
 * `createdAt` anchors the rrule's phase — it matters for interval rules ("every 3
 * days" counts from creation, not from an ever-moving today) and defaults to
 * `now` for a brand-new reminder. A `once` schedule always returns its instant,
 * even if past, so a just-created past reminder fires on the next cron tick.
 */
export function computeNextFireAt(
  schedule: Schedule,
  timezone: string,
  now: Date,
  createdAt: Date = now,
): Date | null {
  if (schedule.type === "once") {
    return zonedWallTimeToUtc(parseWallDateTime(schedule.at), timezone);
  }

  const { hour, minute } = parseTimeOfDay(schedule.time);
  const anchor = localCalendarDate(createdAt, timezone);
  const options = RRule.parseString(schedule.rrule);
  const rule = new RRule({
    ...options,
    dtstart: new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day)),
  });

  const local = localCalendarDate(now, timezone);
  const nowMidnightUtc = Date.UTC(local.year, local.month - 1, local.day);
  let cursor = new Date(nowMidnightUtc - 86_400_000);
  for (let i = 0; i < 500; i += 1) {
    const occurrence = rule.after(cursor, false);
    if (!occurrence) {
      return null;
    }
    cursor = occurrence;
    const fire = zonedWallTimeToUtc(
      {
        year: occurrence.getUTCFullYear(),
        month: occurrence.getUTCMonth() + 1,
        day: occurrence.getUTCDate(),
        hour,
        minute,
      },
      timezone,
    );
    if (fire.getTime() > now.getTime()) {
      return fire;
    }
  }
  return null;
}

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** The seven weekday codes in Mon–Sun order, for the edit sheet's chip row. */
export const WEEKDAYS: readonly WeekdayCode[] = WEEKDAY_CODES;

const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** A weekly rrule for the selected weekdays (kept in Mon–Sun order). */
export function weekdaysToRrule(days: readonly WeekdayCode[]): string {
  const ordered = WEEKDAY_CODES.filter((d) => days.includes(d));
  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
}

/** The weekdays a recurring schedule fires on, parsed from its BYDAY clause. */
export function rruleWeekdays(rrule: string): WeekdayCode[] {
  const match = /BYDAY=([^;]+)/.exec(rrule);
  const codes = match?.[1]?.split(",") ?? [];
  return WEEKDAY_CODES.filter((d) => codes.includes(d));
}

/** "5:00 PM" — the clock time a schedule fires at (from `at` or `time`). */
export function scheduleTimeLabel(schedule: Schedule): string {
  const { hour, minute } =
    schedule.type === "once"
      ? parseWallDateTime(schedule.at)
      : parseTimeOfDay(schedule.time);
  const period = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${`${minute}`.padStart(2, "0")} ${period}`;
}

/**
 * The right-aligned kind label on a reminder row: "once" for one-shots, or the
 * recurrence in words ("Every day", "Mon Wed Fri", or "Repeats" for a pattern
 * with no weekdays, e.g. every-N-days).
 */
export function scheduleKindLabel(schedule: Schedule): string {
  if (schedule.type === "once") {
    return "once";
  }
  const days = rruleWeekdays(schedule.rrule);
  if (days.length === 7) {
    return "Every day";
  }
  if (days.length === 0) {
    return "Repeats";
  }
  return days.map((d) => WEEKDAY_LABELS[d]).join(" ");
}
