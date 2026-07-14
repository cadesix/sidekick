// Daily streak: bumped once per local calendar day when the app opens. A missed
// day resets to 1 on the next visit. Reward claiming/coin grants come later —
// for now the streak sheet derives milestone state purely from the count.

export const STREAK_KEY = "sidekick_streak_v1";

type StreakState = { count: number; last: string }; // last = local YYYY-MM-DD

function dayString(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function load(): StreakState | null {
	try {
		const raw = localStorage.getItem(STREAK_KEY);
		if (!raw) return null;
		const s = JSON.parse(raw) as StreakState;
		return typeof s.count === "number" && typeof s.last === "string" ? s : null;
	} catch {
		return null;
	}
}

// Call on app open: counts today (idempotent) and returns the current streak.
export function touchStreak(): number {
	const today = dayString(new Date());
	const yesterday = dayString(new Date(Date.now() - 86400000));
	const s = load();
	const next: StreakState =
		s?.last === today ? s : { count: s?.last === yesterday ? s.count + 1 : 1, last: today };
	try {
		localStorage.setItem(STREAK_KEY, JSON.stringify(next));
	} catch {
		// storage full/blocked — streak just won't persist
	}
	return next.count;
}
