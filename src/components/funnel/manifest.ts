import posthog from "posthog-js";
import { DEFAULT_PAYWALL_VARIANT } from "./constants";
import { ILLUSTRATIONS } from "./illustrations";
import { PERSONA_OPTIONS } from "./persona";
import type { FunnelAssignment, FunnelManifest, PaywallVariant, StepConfig } from "./types";

const LANDING: StepConfig = { id: "landing", type: "landing", role: "landing" };

const PERSONA_QUESTION: StepConfig = {
	id: "persona",
	type: "quiz",
	role: "question",
	question: {
		id: "persona",
		title: "What brings you to Relic?",
		subtitle: "Pick the closest — we'll build your plan around it.",
		options: PERSONA_OPTIONS,
	},
};

const AUTHORITY: StepConfig = {
	id: "authority",
	type: "interstitial",
	role: "interstitial",
	interstitial: {
		kind: "authority",
		title: "Real Price Data\nfrom Live Auctions",
		illustration: ILLUSTRATIONS.gavel,
		illustrationPosition: "top",
		align: "center",
	},
};

const PAIN: StepConfig = {
	id: "pain",
	type: "agreement",
	role: "question",
	agreement: {
		id: "pain",
		fallback: "I bet I own things worth more than I realize.",
		subtitle: "Be honest — does this sound like you?",
		statements: {
			collector: "I bet I own things worth more than I realize.",
			thrifter: "I've walked past something valuable because I couldn't tell treasure from junk.",
			inheritor: "I'm worried I'll give away or toss something genuinely valuable.",
			reseller: "I've bought on a hunch and later wondered if I overpaid.",
			seller: "When I sell, I always wonder if the buyer knows something I don't.",
		},
	},
};

const REPRO_QUESTION: StepConfig = {
	id: "repro",
	type: "quiz",
	role: "question",
	question: {
		id: "repro",
		title: "Could you tell a real antique from a good reproduction?",
		subtitle: "By eye alone — no markings, no research.",
		options: [
			{ value: "confident", label: "Yes, confidently", emoji: "🧐" },
			{ value: "sometimes", label: "Sometimes", emoji: "🤷" },
			{ value: "no", label: "Probably not", emoji: "🙈" },
		],
	},
};

const REPRO_EDUCATION: StepConfig = {
	id: "repro-education",
	type: "interstitial",
	role: "interstitial",
	interstitial: {
		kind: "micro-education",
		title: "Even the experts get fooled.",
		body: "One of these could be worth thousands — the other, made last month. A skilled finisher can fake a century of wear in an afternoon, so Relic checks the evidence instead: maker marks, construction, and what the real ones actually sold for.",
		illustration: ILLUSTRATIONS.twinVases,
	},
};

const ITEMS_QUESTION: StepConfig = {
	id: "items",
	type: "multi-select",
	role: "question",
	question: {
		id: "items",
		title: "What do you own or hunt for?",
		subtitle: "Pick all that apply — your report is built from this.",
		minSelections: 1,
		options: [
			{ value: "furniture", label: "Furniture", emoji: "🪑" },
			{ value: "jewelry", label: "Jewelry & watches", emoji: "💍" },
			{ value: "coins", label: "Coins & currency", emoji: "🪙" },
			{ value: "art", label: "Art & prints", emoji: "🖼️" },
			{ value: "ceramics", label: "Ceramics & glass", emoji: "🏺" },
			{ value: "toys", label: "Toys & collectibles", emoji: "🧸" },
			{ value: "militaria", label: "Militaria", emoji: "🎖️" },
			{ value: "tools", label: "Tools", emoji: "🔧" },
			{ value: "other", label: "Something else", emoji: "✨" },
		],
	},
};

const SOCIAL_PROOF: StepConfig = {
	id: "social-proof",
	type: "interstitial",
	role: "interstitial",
	interstitial: {
		kind: "social-proof",
		title: "You're in good company.",
	},
};

const STAKES_QUESTION: StepConfig = {
	id: "stakes",
	type: "quiz",
	role: "question",
	question: {
		id: "stakes",
		title: "Your best guess — what's the most valuable thing you own?",
		options: [
			{ value: "under-50", label: "Under $50" },
			{ value: "50-500", label: "$50 – $500" },
			{ value: "500-5000", label: "$500 – $5,000" },
			{ value: "over-5000", label: "More than $5,000" },
			{ value: "no-idea", label: "Honestly, no idea" },
		],
	},
};

const STAKES_EDUCATION: StepConfig = {
	id: "stakes-education",
	type: "interstitial",
	role: "interstitial",
	interstitial: {
		kind: "micro-education",
		title: "92% of Relic users previously undervalued what they own.",
		illustration: ILLUSTRATIONS.hourglass,
		illustrationPosition: "top",
		align: "center",
	},
};

const HOW_IT_WORKS: StepConfig = {
	id: "how-it-works",
	type: "interstitial",
	role: "interstitial",
	interstitial: {
		kind: "how-it-works",
		title: "How Relic works",
		subtitle: "From photo to value in about ten seconds.",
	},
};

const FREQUENCY_QUESTION: StepConfig = {
	id: "frequency",
	type: "quiz",
	role: "question",
	question: {
		id: "frequency",
		title: "How often are you hunting or sorting through items?",
		subtitle: "We'll pace your plan to match.",
		options: [
			{ value: "weekly", label: "Every week", emoji: "🔁" },
			{ value: "monthly", label: "A few times a month", emoji: "📅" },
			{ value: "one-batch", label: "One collection or estate, right now", emoji: "📦" },
		],
	},
};

const LOADING: StepConfig = { id: "loading", type: "loading", role: "loading" };
const RESULTS: StepConfig = { id: "results", type: "results", role: "reveal" };
const AUTH: StepConfig = { id: "auth", type: "auth", role: "auth" };

const PRE_PAYWALL: StepConfig = {
	id: "pre-paywall",
	type: "interstitial",
	role: "interstitial",
	interstitial: {
		kind: "pre-paywall",
		title: "People love Relic",
	},
};

const PAYWALL: StepConfig = { id: "paywall", type: "paywall", role: "paywall" };
const SUCCESS: StepConfig = { id: "success", type: "success", role: "success" };

export const FUNNEL_EXPERIMENT_KEY = "web-funnel-variant";
export const PAYWALL_EXPERIMENT_KEY = "web-funnel-paywall";
export const DEFAULT_VARIANT = "default";

export const FUNNEL_ID = "relic_web_quiz";
const FUNNEL_VERSION = 1;

function manifest(variantKey: string, steps: StepConfig[]): FunnelManifest {
	return {
		funnelId: FUNNEL_ID,
		funnelVersion: FUNNEL_VERSION,
		funnelRevisionId: `${FUNNEL_ID}.v${FUNNEL_VERSION}.${variantKey}.2026-06-18`,
		experimentKey: FUNNEL_EXPERIMENT_KEY,
		variantKey,
		steps,
	};
}

const VARIANT_STEPS: Record<string, StepConfig[]> = {
	default: [
		LANDING,
		PERSONA_QUESTION,
		AUTHORITY,
		PAIN,
		REPRO_QUESTION,
		REPRO_EDUCATION,
		ITEMS_QUESTION,
		SOCIAL_PROOF,
		STAKES_QUESTION,
		STAKES_EDUCATION,
		HOW_IT_WORKS,
		FREQUENCY_QUESTION,
		LOADING,
		RESULTS,
		PRE_PAYWALL,
		PAYWALL,
		AUTH,
		SUCCESS,
	],
	// Minimal path for fast QA of paywall + post-pay auth.
	direct: [PERSONA_QUESTION, ITEMS_QUESTION, LOADING, RESULTS, PAYWALL, AUTH, SUCCESS],
};

// The variant key is written once (here) and threaded into the manifest, so a new
// arm can't silently ship with another arm's revision id / experiment_variant.
export const FUNNEL_MANIFESTS: Record<string, FunnelManifest> = Object.fromEntries(
	Object.entries(VARIANT_STEPS).map(([variantKey, steps]) => [
		variantKey,
		manifest(variantKey, steps),
	]),
);

// Resolve the funnel + paywall experiment arms once, then pin them (the caller
// persists the result) so the variant survives the post-paywall auth redirect
// instead of being re-evaluated on the next page load.
export function resolveAssignment(saved: FunnelAssignment | null): FunnelAssignment {
	if (saved && saved.variant in FUNNEL_MANIFESTS) {
		return saved;
	}

	if (typeof window === "undefined") {
		return { variant: DEFAULT_VARIANT, paywallVariant: DEFAULT_PAYWALL_VARIANT, assignedAt: "" };
	}

	const variantFlag = posthog.getFeatureFlag(FUNNEL_EXPERIMENT_KEY);
	const variant =
		typeof variantFlag === "string" && variantFlag in FUNNEL_MANIFESTS
			? variantFlag
			: DEFAULT_VARIANT;

	const paywallFlag = posthog.getFeatureFlag(PAYWALL_EXPERIMENT_KEY);
	const paywallVariant: PaywallVariant =
		paywallFlag === "no_trial" ? "no_trial" : DEFAULT_PAYWALL_VARIANT;

	return { variant, paywallVariant, assignedAt: new Date().toISOString() };
}
