import { BOND_KEY } from "./sidekick-bond";
import { COINS_KEY, INV_KEY } from "./sidekick-economy";
import { STREAK_KEY } from "./sidekick-streak";

// The user's profile state, seen as one thing. Every feature persists its own
// slice under its own localStorage key (bond, streak, coins, inventory, goals…),
// which is right for the app — but for BUILDING the app we need to hop between
// whole coherent user states ("fresh install", "day-3 hooked", "day-90 whale").
// This module is that registry: the full key list, an onboarding-phase key that
// progressive onboarding will branch on, and canned PERSONAS the dev panel (and
// ?persona= deep links) can apply in one shot. Applying writes the keys and
// reloads — every store re-reads at mount, so a reload IS a clean state swap.

// Progressive-onboarding phase. Features branch on this as they gain
// phase-aware behavior; the funnel/chat flows will advance it later.
export const ONBOARDING_KEY = "sidekick_onboarding_v1";
export const ONBOARDING_PHASES = ["new", "goals-set", "met-sidekick", "first-chat", "established"] as const;
export type OnboardingPhase = (typeof ONBOARDING_PHASES)[number];

export function loadOnboardingPhase(): OnboardingPhase {
	try {
		const v = localStorage.getItem(ONBOARDING_KEY) as OnboardingPhase | null;
		return v && ONBOARDING_PHASES.includes(v) ? v : "new";
	} catch {
		return "new";
	}
}

export function setOnboardingPhase(p: OnboardingPhase): void {
	try {
		localStorage.setItem(ONBOARDING_KEY, p);
	} catch {
		// storage full/blocked
	}
}

// every key that makes up a user profile — keep in sync as features land
export const PROFILE_KEYS = [
	BOND_KEY,
	STREAK_KEY,
	COINS_KEY,
	INV_KEY,
	ONBOARDING_KEY,
	"sidekick_goals_v1",
	"sidekick_plan_v1",
	"sidekick_habit_checks_v1",
	"sidekick_profile_v1",
	"sidekick_chat_v1",
	"sidekick_unread_v1",
	"sidekick_daily_box_v1",
	"sidekick-wardrobe-v1",
	"funnel_session",
	"sidekick_funnel_answers_v1",
	"sidekick_onboarding_step_v1",
	"sidekick_context_v1",
];

function localDay(offsetDays = 0): string {
	const d = new Date(Date.now() + offsetDays * 86400000);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type Persona = {
	label: string;
	blurb: string;
	bond: number;
	streakDays: number;
	coins: number;
	inventory: string[];
	onboarding: OnboardingPhase;
	goals?: string[];
};

export const PERSONAS: Record<string, Persona> = {
	fresh: {
		label: "Fresh install",
		blurb: "Day 0, nothing set",
		bond: 10,
		streakDays: 1,
		coins: 250,
		inventory: [],
		onboarding: "new",
	},
	day3: {
		label: "Day 3 (hooked)",
		blurb: "Early streak, first cosmetic",
		bond: 18,
		streakDays: 3,
		coins: 95,
		inventory: ["beanie-charcoal"],
		onboarding: "first-chat",
		goals: ["get-fit"],
	},
	week2: {
		label: "Week 2 (regular)",
		blurb: "Blossom unlocked, small closet",
		bond: 45,
		streakDays: 14,
		coins: 420,
		inventory: ["beanie-charcoal", "glasses-black", "sneakers-white", "backpack-sky", "hoodie-navy"],
		onboarding: "established",
		goals: ["get-fit", "sleep-better"],
	},
	day90: {
		label: "Day 90 (power user)",
		blurb: "Everything but Ember, deep closet",
		bond: 90,
		streakDays: 92,
		coins: 1800,
		inventory: [
			"beanie-charcoal",
			"glasses-black",
			"sneakers-white",
			"backpack-sky",
			"hoodie-navy",
			"wizard-purple",
			"bucket-night",
			"boots-brown",
			"shorts-red",
			"hat-forest",
			"shirt-dots",
			"pants-khaki",
		],
		onboarding: "established",
		goals: ["get-fit", "sleep-better", "be-productive"],
	},
};

// write the whole profile and reload so every store re-reads clean state
export function applyPersona(name: keyof typeof PERSONAS): void {
	const p = PERSONAS[name];
	if (!p) return;
	try {
		for (const k of PROFILE_KEYS) localStorage.removeItem(k);
		localStorage.setItem(BOND_KEY, String(p.bond));
		localStorage.setItem(STREAK_KEY, JSON.stringify({ count: p.streakDays, last: localDay() }));
		localStorage.setItem(COINS_KEY, String(p.coins));
		localStorage.setItem(INV_KEY, JSON.stringify(p.inventory));
		localStorage.setItem(ONBOARDING_KEY, p.onboarding);
		if (p.goals) localStorage.setItem("sidekick_goals_v1", JSON.stringify(p.goals));
	} catch {
		// storage blocked — nothing to apply
	}
	window.location.reload();
}

// wipe the profile entirely (keeps look-dev settings etc. untouched)
export function resetProfile(): void {
	try {
		for (const k of PROFILE_KEYS) localStorage.removeItem(k);
	} catch {
		// storage blocked
	}
	window.location.reload();
}

// dev bootstrap: /home4?persona=week2 applies and strips the param. Call once
// at app start (dev only).
export function applyPersonaFromUrl(): void {
	const name = new URLSearchParams(window.location.search).get("persona");
	if (!name || !(name in PERSONAS)) return;
	const url = new URL(window.location.href);
	url.searchParams.delete("persona");
	// write state, then replace the URL WITHOUT the param before reloading —
	// otherwise the reload re-applies forever
	const p = PERSONAS[name];
	try {
		for (const k of PROFILE_KEYS) localStorage.removeItem(k);
		localStorage.setItem(BOND_KEY, String(p.bond));
		localStorage.setItem(STREAK_KEY, JSON.stringify({ count: p.streakDays, last: localDay() }));
		localStorage.setItem(COINS_KEY, String(p.coins));
		localStorage.setItem(INV_KEY, JSON.stringify(p.inventory));
		localStorage.setItem(ONBOARDING_KEY, p.onboarding);
		if (p.goals) localStorage.setItem("sidekick_goals_v1", JSON.stringify(p.goals));
	} catch {
		return;
	}
	window.location.replace(url.toString());
}
