/**
 * Pure date helpers for the home header and chat day-separators. RN-free so they
 * are unit-tested from the root vitest suite. All "now"-relative helpers take an
 * explicit `now` so they are deterministic.
 */

/** Time-of-day greeting for the home header (07 §1). */
export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

/** "Monday, July 7" — the home header date line (07 §1). */
export function todayLabel(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** Local calendar-day key (YYYY-MM-DD) used to group messages into days. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(a: Date, b: Date): number {
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startB - startA) / 86_400_000);
}

/**
 * iMessage-style day-separator label (08 client UX): "Today" / "Yesterday" for
 * the two most recent local days, otherwise "Mon, Jun 29".
 */
export function dayLabel(date: Date, now: Date): string {
  const delta = daysBetween(date, now);
  if (delta === 0) {
    return "Today";
  }
  if (delta === 1) {
    return "Yesterday";
  }
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
