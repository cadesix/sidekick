import {
	ACCURACY_TESTIMONIAL,
	COLLECTOR_TESTIMONIAL,
	RESELLER_TESTIMONIAL,
	type Testimonial,
} from "./constants";
import type { Persona, QuizOption } from "./types";

export const PERSONA_OPTIONS: QuizOption[] = [
	{
		value: "collector",
		label: "I'm a collector",
		description: "I want to know what I'm really holding",
		emoji: "🏺",
	},
	{
		value: "thrifter",
		label: "I thrift & hunt flea markets",
		description: "Estate sales, garage sales, the goodwill bins",
		emoji: "🔍",
	},
	{
		value: "inheritor",
		label: "I inherited items",
		description: "An estate or family heirlooms to sort out",
		emoji: "📦",
	},
	{
		value: "reseller",
		label: "I buy to resell",
		description: "Picker, dealer, or online reseller",
		emoji: "🏷️",
	},
	{
		value: "seller",
		label: "I want to sell something",
		description: "And get the real number before I do",
		emoji: "💰",
	},
];

function isPersona(value: string | undefined): value is Persona {
	return (
		value === "collector" ||
		value === "thrifter" ||
		value === "inheritor" ||
		value === "reseller" ||
		value === "seller"
	);
}

export function resolvePersona(value: Persona | undefined): Persona {
	return isPersona(value) ? value : "collector";
}

/** Archetype name revealed on the results step — the quiz's "your result". */
export const PERSONA_ARCHETYPE: Record<Persona, string> = {
	collector: "The Curator",
	thrifter: "The Treasure Hunter",
	inheritor: "The Steward",
	reseller: "The Picker",
	seller: "The Dealmaker",
};

/** Plural word used in peer-matched social proof ("1,200+ thrifters"). */
export const PERSONA_WORD: Record<Persona, string> = {
	collector: "collectors",
	thrifter: "thrifters",
	inheritor: "people sorting an estate",
	reseller: "resellers",
	seller: "sellers",
};

/** Best-matched real testimonial for the mid-funnel social proof step. */
export const PERSONA_TESTIMONIAL: Record<Persona, Testimonial> = {
	collector: COLLECTOR_TESTIMONIAL,
	thrifter: COLLECTOR_TESTIMONIAL,
	inheritor: ACCURACY_TESTIMONIAL,
	reseller: RESELLER_TESTIMONIAL,
	seller: RESELLER_TESTIMONIAL,
};

/** A different quote for the pre-paywall close, so the funnel never repeats itself. */
export const PERSONA_CLOSING_TESTIMONIAL: Record<Persona, Testimonial> = {
	collector: ACCURACY_TESTIMONIAL,
	thrifter: ACCURACY_TESTIMONIAL,
	inheritor: COLLECTOR_TESTIMONIAL,
	reseller: ACCURACY_TESTIMONIAL,
	seller: ACCURACY_TESTIMONIAL,
};
