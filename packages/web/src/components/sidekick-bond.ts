// Bond: how much the sidekick knows about you (0–100). It grows through guided
// sessions — chats where the sidekick learns your background, routine, goals,
// where you live, your life in general (session flow comes later; it just calls
// addBond). Map destinations unlock at bond thresholds, and the score floats
// over the character's head on the home screen.

export const BOND_KEY = "sidekick_bond_v1";
export const BOND_MAX = 100;
// every sidekick starts a little bonded — the score reads as a percent and
// never drops below this floor
export const BOND_MIN = 10;
const BOND_EVENT = "sidekick:bond";

export function loadBond(): number {
	try {
		const v = Number(localStorage.getItem(BOND_KEY));
		return Number.isFinite(v) ? Math.min(BOND_MAX, Math.max(BOND_MIN, v)) : BOND_MIN;
	} catch {
		return BOND_MIN;
	}
}

// bump the score (guided sessions call this as they learn things) and notify
// any mounted UI — returns the new value
export function addBond(amount: number): number {
	const next = Math.min(BOND_MAX, Math.max(BOND_MIN, loadBond() + amount));
	try {
		localStorage.setItem(BOND_KEY, String(next));
	} catch {
		// storage full/blocked — the gain just won't persist
	}
	window.dispatchEvent(new CustomEvent(BOND_EVENT, { detail: next }));
	return next;
}

export function subscribeBond(cb: (value: number) => void): () => void {
	const onBond = (e: Event) => cb((e as CustomEvent<number>).detail);
	window.addEventListener(BOND_EVENT, onBond);
	return () => window.removeEventListener(BOND_EVENT, onBond);
}

// dev-console lever until guided sessions exist: __bond.add(10)
if (import.meta.env.DEV && typeof window !== "undefined") {
	(window as unknown as { __bond: unknown }).__bond = { add: addBond, load: loadBond };
}
