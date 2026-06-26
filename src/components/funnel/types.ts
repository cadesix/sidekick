export type Persona = "collector" | "thrifter" | "inheritor" | "reseller" | "seller";

export type PaywallVariant = "trial" | "no_trial";

export type StepRole =
	| "landing"
	| "question"
	| "interstitial"
	| "loading"
	| "reveal"
	| "auth"
	| "paywall"
	| "success";

export type StepType =
	| "landing"
	| "quiz"
	| "multi-select"
	| "agreement"
	| "interstitial"
	| "loading"
	| "results"
	| "auth"
	| "paywall"
	| "success";

export interface QuizOption {
	label: string;
	value: string;
	description?: string;
	emoji?: string;
}

export interface QuizQuestion {
	id: string;
	title: string;
	subtitle?: string;
	options: QuizOption[];
}

export interface MultiSelectQuestion {
	id: string;
	title: string;
	subtitle?: string;
	minSelections: number;
	options: QuizOption[];
}

export interface AgreementConfig {
	id: string;
	statements: Partial<Record<Persona, string>>;
	fallback: string;
	subtitle?: string;
}

export type InterstitialKind =
	| "authority"
	| "social-proof"
	| "how-it-works"
	| "micro-education"
	| "pre-paywall";

export interface StepIllustration {
	src: string;
	alt: string;
	width: number;
	height: number;
}

export interface InterstitialConfig {
	kind: InterstitialKind;
	title: string;
	subtitle?: string;
	body?: string;
	illustration?: StepIllustration;
	/** Center the title/subtitle instead of the default left alignment. */
	align?: "center";
	/** Render the illustration above the title rather than below it. */
	illustrationPosition?: "top";
}

export type StepConfig = (
	| { id: string; type: "landing"; role: "landing" }
	| { id: string; type: "quiz"; role: "question"; question: QuizQuestion }
	| { id: string; type: "multi-select"; role: "question"; question: MultiSelectQuestion }
	| { id: string; type: "agreement"; role: "question"; agreement: AgreementConfig }
	| { id: string; type: "interstitial"; role: "interstitial"; interstitial: InterstitialConfig }
	| { id: string; type: "loading"; role: "loading" }
	| { id: string; type: "results"; role: "reveal" }
	| { id: string; type: "auth"; role: "auth" }
	| { id: string; type: "paywall"; role: "paywall" }
	| { id: string; type: "success"; role: "success" }
) & {
	/** Bump when a step's copy/options change so PostHog can tell versions apart. */
	version?: number;
};

export interface FunnelManifest {
	funnelId: string;
	funnelVersion: number;
	/** Unique per deployed variant, e.g. `relic_web_quiz.v1.default.2026-06-18`. */
	funnelRevisionId: string;
	experimentKey: string;
	variantKey: string;
	steps: StepConfig[];
}

export interface FunnelAssignment {
	variant: string;
	paywallVariant: PaywallVariant;
	assignedAt: string;
}

export interface FunnelAnswers {
	persona?: Persona;
	[questionId: string]: string | string[] | undefined;
}

export interface FunnelTrackingProps {
	fbclid: string | null;
	fbc: string | null;
	fbp: string | null;
	utmSource: string | null;
	utmMedium: string | null;
	utmCampaign: string | null;
	utmContent: string | null;
	utmTerm: string | null;
}
