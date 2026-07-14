// Coin balance + owned-cosmetics inventory. Products are identified by their
// render key ("hoodie-navy", "beanie-c2f9e8f") — the same slug the shop and
// renders already use. Coins deplete on purchase and grow from streaks/goals
// (those grants land later; addCoins is the hook). Both stores broadcast a
// window event so any mounted UI (shop header, closet) updates live.

export const COINS_KEY = "sidekick_coins_v1";
export const INV_KEY = "sidekick_inventory_v1";
const COINS_EVENT = "sidekick:coins";
const START_COINS = 250;
// the outfit you start with is already yours
const START_INVENTORY = ["shirt-sky"];

export function loadCoins(): number {
	try {
		const v = Number(localStorage.getItem(COINS_KEY));
		return Number.isFinite(v) && localStorage.getItem(COINS_KEY) !== null ? Math.max(0, v) : START_COINS;
	} catch {
		return START_COINS;
	}
}

function saveCoins(v: number): void {
	try {
		localStorage.setItem(COINS_KEY, String(v));
	} catch {
		// storage full/blocked
	}
	window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail: v }));
}

export function addCoins(amount: number): number {
	const next = Math.max(0, loadCoins() + amount);
	saveCoins(next);
	return next;
}

// returns false (and charges nothing) when the balance can't cover it
export function spendCoins(amount: number): boolean {
	const bal = loadCoins();
	if (bal < amount) return false;
	saveCoins(bal - amount);
	return true;
}

export function subscribeCoins(cb: (value: number) => void): () => void {
	const on = (e: Event) => cb((e as CustomEvent<number>).detail);
	window.addEventListener(COINS_EVENT, on);
	return () => window.removeEventListener(COINS_EVENT, on);
}

export function loadInventory(): Set<string> {
	try {
		const raw = localStorage.getItem(INV_KEY);
		const saved: string[] = raw ? JSON.parse(raw) : [];
		return new Set([...START_INVENTORY, ...saved]);
	} catch {
		return new Set(START_INVENTORY);
	}
}

export function addToInventory(productKey: string): void {
	try {
		localStorage.setItem(INV_KEY, JSON.stringify([...loadInventory().add(productKey)]));
	} catch {
		// storage full/blocked
	}
}
