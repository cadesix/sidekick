/**
 * Date helpers for the memory block. Two cache-stability rules from
 * user-memory.md §3 / 08 live here: render the local *date* (never the clock
 * time) and compute relative-date strings that only change at local midnight.
 * Everything is derived from a `{ year, month, day }` calendar date, so the same
 * `now` produces the same strings for the whole local day — the memory block
 * stays byte-identical between turns and the Anthropic cache holds.
 */
export type CalendarDate = { year: number; month: number; day: number };

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** The user-local calendar date of `now`, via the IANA timezone. */
export function localCalendarDate(now: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Parse a Drizzle `date` string ("YYYY-MM-DD") to a calendar date. */
export function parseCalendarDate(value: string): CalendarDate {
  const [year, month, day] = value.split("-").map((n) => Number(n));
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

function toUtcMillis(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/** Whole calendar days from `from` to `to` (positive = `to` is in the future). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const ms = toUtcMillis(to) - toUtcMillis(from);
  return Math.round(ms / 86_400_000);
}

function weekdayOf(date: CalendarDate): string {
  return WEEKDAYS[new Date(toUtcMillis(date)).getUTCDay()] ?? "";
}

/** "friday, july 3" — the header date, no year, no time. */
export function formatToday(today: CalendarDate): string {
  return `${weekdayOf(today)}, ${MONTHS[today.month - 1]} ${today.day}`;
}

/** "jul 12" — a compact absolute date for disambiguating far-off events. */
export function formatShortDate(date: CalendarDate): string {
  return `${(MONTHS[date.month - 1] ?? "").slice(0, 3)} ${date.day}`;
}

/**
 * A friend's phrasing of when a dated event falls relative to today: "yesterday",
 * "in 9 days (jul 12)", "3 days ago", or a weekday+date for anything further out.
 * The model reasons far better about "yesterday" than about date arithmetic
 * (user-memory.md §3), so relative phrasing is preferred near today.
 */
export function relativeDay(event: CalendarDate, today: CalendarDate): string {
  const delta = daysBetween(today, event);
  if (delta === 0) {
    return "today";
  }
  if (delta === 1) {
    return "tomorrow";
  }
  if (delta === -1) {
    return "yesterday";
  }
  if (delta > 1 && delta <= 14) {
    return `in ${delta} days (${formatShortDate(event)})`;
  }
  if (delta < -1 && delta >= -14) {
    return `${-delta} days ago`;
  }
  return `${weekdayOf(event)}, ${formatShortDate(event)}`;
}
