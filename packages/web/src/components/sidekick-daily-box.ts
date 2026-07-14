import { addCoins, addToInventory } from "./sidekick-economy";

// The daily box — the steady-state coin faucet (docs/token-economy.md).
// One box per local day, spawned on the ground next to the character on the
// first session of the day. Contents = a guaranteed coin roll (band by streak
// tier) + a bonus slot (~1-in-7 days the roll pays double) + the streak
// milestone reward on milestone days. Rolls are seeded by (date, "daily-box"),
// so the day's contents are fixed before the box is opened and reloading
// never rerolls — randomness is presentation, expected value is fixed.

export const DAILY_BOX_KEY = "sidekick_daily_box_v1"; // last claimed YYYY-MM-DD

// Streak milestone schedule: a reward every day for week one, then tapering
// (10, 14, 21, 30…365) so later rewards keep scarcity. Rewards are coins or
// real shop cosmetics (product renders). On milestone days the daily box is
// visually special and carries the reward on top of the coin roll.
export type Milestone = { day: number; label: string; coins?: number; render?: string };

export const MILESTONES: Milestone[] = [
	{ day: 1, label: "10 coins", coins: 10 },
	{ day: 2, label: "15 coins", coins: 15 },
	{ day: 3, label: "Charcoal Beanie", render: "beanie-charcoal" },
	{ day: 4, label: "20 coins", coins: 20 },
	{ day: 5, label: "25 coins", coins: 25 },
	{ day: 6, label: "Black Glasses", render: "glasses-black" },
	{ day: 7, label: "White Sneakers", render: "sneakers-white" },
	{ day: 10, label: "40 coins", coins: 40 },
	{ day: 14, label: "Sky Backpack", render: "backpack-sky" },
	{ day: 21, label: "75 coins", coins: 75 },
	{ day: 30, label: "Wizard Hat", render: "wizard-purple" },
	{ day: 45, label: "100 coins", coins: 100 },
	{ day: 60, label: "Night Bucket Hat", render: "bucket-night" },
	{ day: 90, label: "200 coins", coins: 200 },
	{ day: 180, label: "Silver Crown", render: "crown-silver" },
	{ day: 365, label: "Gold Crown", render: "crown-gold" },
];

// box tier bands: expected 20/25/30 per day, ±10% so opening feels alive but
// weekly income converges on the curve (docs/token-economy.md#faucets)
export type BoxTier = "base" | "silver" | "gold";
const TIER_BANDS: Record<BoxTier, [number, number]> = {
	base: [18, 22],
	silver: [22, 28],
	gold: [27, 33],
};

export function boxTier(streak: number): BoxTier {
	return streak >= 30 ? "gold" : streak >= 7 ? "silver" : "base";
}

export type BoxReward = {
	tier: BoxTier;
	coins: number; // the guaranteed roll (pre-double)
	doubled: boolean; // bonus slot hit: the roll pays out twice
	milestone?: Milestone; // present on milestone days
	total: number; // coins actually granted (roll × double + milestone coins)
};

function localDay(offsetDays = 0): string {
	const d = new Date(Date.now() + offsetDays * 86400000);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// same deterministic PRNG family as the shop rotation (shop-sheet.tsx)
function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hashStr(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

// true when today's box hasn't been claimed yet (= "first session of the day")
export function hasDailyBox(): boolean {
	try {
		return localStorage.getItem(DAILY_BOX_KEY) !== localDay();
	} catch {
		return false;
	}
}

// Pure seeded roll for today's box — safe to call any number of times.
export function rollDailyBox(streak: number): BoxReward {
	const rng = mulberry32(hashStr(`${localDay()}|daily-box`));
	const tier = boxTier(streak);
	const [min, max] = TIER_BANDS[tier];
	const coins = min + Math.floor(rng() * (max - min + 1));
	const doubled = rng() < 1 / 7;
	const milestone = MILESTONES.find((m) => m.day === streak);
	const total = coins * (doubled ? 2 : 1) + (milestone?.coins ?? 0);
	return { tier, coins, doubled, milestone, total };
}

// Grant today's box (coins + milestone item) and mark it claimed. Idempotent:
// returns null if already claimed today.
export function claimDailyBox(streak: number): BoxReward | null {
	if (!hasDailyBox()) return null;
	const reward = rollDailyBox(streak);
	try {
		localStorage.setItem(DAILY_BOX_KEY, localDay());
	} catch {
		// storage blocked — grant anyway, worst case the box reappears
	}
	addCoins(reward.total);
	if (reward.milestone?.render) addToInventory(reward.milestone.render);
	return reward;
}
