// Daily streak: bumped once per local calendar day when the app opens; a missed
// day resets to 1. Pure day-math — the app passes today/yesterday strings (from
// localDay) and persists the returned state.

export type StreakState = { count: number; last: string }; // last = local YYYY-MM-DD

// Idempotent per day: same day → unchanged; consecutive day → +1; gap → reset.
export function computeStreak(
  prev: StreakState | null,
  today: string,
  yesterday: string,
): StreakState {
  if (prev?.last === today) return prev;
  return { count: prev?.last === yesterday ? prev.count + 1 : 1, last: today };
}
