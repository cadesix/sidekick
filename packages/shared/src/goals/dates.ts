/**
 * Local-time helpers for the check-in engine. All check-in scheduling and
 * streak math is done in the *user's* local calendar day, computed from their
 * IANA `timezone` — never the server's clock. `at` is injectable so cron and
 * tests can freeze time (03: "freeze time via injectable clock param").
 */

/** The user's local calendar date as "YYYY-MM-DD". */
export function localDate(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The user's local hour (0–23). Used for reminder-time timezone sharding. */
export function localHour(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "0";
  return Number(hour) % 24;
}

/** Shift a "YYYY-MM-DD" date string by whole days (pure calendar math, UTC-anchored). */
export function addDays(date: string, days: number): string {
  const parts = date.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The lower bound of the rolling 7-day window ending on `date` (inclusive). */
export function weekStart(date: string): string {
  return addDays(date, -6);
}

/**
 * Consecutive days ending at (or the day before) `today` on which the user made
 * progress. Today not being logged yet doesn't break the streak — it counts up
 * to yesterday until today lands. Plan 04 owns rewards; this owns the count.
 */
export function currentStreak(hitDates: Iterable<string>, today: string): number {
  const set = new Set(hitDates);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
