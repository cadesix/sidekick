// Step model for the Northstar funnel. Kept intentionally small — the funnel is
// being rebuilt from basics. FunnelHog parses the `const X: StepConfig = {...}`
// declarations in manifest.ts, so every step keeps an `id`, a `type`, and a
// `title` it can read for the editor label.

export type StepType =
	| "welcome"
	| "name"
	| "choice"
	| "goals"
	| "transition"
	| "quiz-intro"
	| "statement"
	| "personality"
	| "fact"
	| "result"
	| "reveal"
	| "meet"
	| "onboarding-chat"
	| "complete";

export type StepRole = "landing" | "question" | "interstitial" | "success";

export interface GoalOption {
	value: string;
	label: string;
	/** Path to a Sidekick-style icon in /public (preferred). */
	icon?: string;
	/** Fallback emoji if no icon is set. */
	emoji?: string;
}

export interface GoalsConfig {
	id: string;
	title: string;
	subtitle?: string;
	/** Minimum goals the user must pick before continuing. */
	minSelections: number;
	options: GoalOption[];
}

/** The five Big Five traits. Stored per item so answers can be scored later. */
export type BigFiveTrait = "O" | "C" | "E" | "A" | "N";

export interface PersonalityScaleOption {
	value: string;
	label: string;
}

export interface PersonalityItem {
	id: string;
	text: string;
	trait: BigFiveTrait;
	/** Reverse-keyed item (disagreement indicates a high trait score). */
	reverse?: boolean;
	/** Optional themed hero illustration shown above the statement. */
	image?: string;
}

/** A single-select choice option (age groups, gender, …). */
export interface ChoiceOption {
	value: string;
	label: string;
}

export type StepConfig = (
	| { id: string; type: "welcome"; role: "landing"; title: string; subtitle?: string; cta?: string }
	| { id: string; type: "name"; role: "question"; title: string; subtitle?: string; placeholder?: string }
	| { id: string; type: "choice"; role: "question"; key: string; title: string; subtitle?: string; options: ChoiceOption[] }
	| { id: string; type: "statement"; role: "interstitial"; title: string; image?: string; cta?: string }
	| { id: string; type: "goals"; role: "question"; question: GoalsConfig }
	| { id: string; type: "transition"; role: "interstitial"; title: string; body?: string }
	| { id: string; type: "quiz-intro"; role: "interstitial"; title: string; body?: string }
	| { id: string; type: "fact"; role: "interstitial"; label?: string; title: string }
	| { id: string; type: "personality"; role: "question"; question: PersonalityItem }
	| { id: string; type: "complete"; role: "success"; title: string; subtitle?: string }
	| { id: string; type: "result"; role: "success"; title: string }
	| { id: string; type: "reveal"; role: "success"; title: string; subtitle?: string; cta?: string }
	| { id: string; type: "meet"; role: "success"; title?: string; cta?: string }
	| { id: string; type: "onboarding-chat"; role: "success"; title: string }
) & {
	/** Bump when a step's copy/options change so analytics can tell versions apart. */
	version?: number;
};

export interface FunnelAnswers {
	name?: string;
	age?: string;
	gender?: string;
	goals?: string[];
	/** itemId -> chosen scale value (e.g. "q1" -> "4"). */
	personality?: Record<string, string>;
	[questionId: string]: string | string[] | Record<string, string> | undefined;
}
