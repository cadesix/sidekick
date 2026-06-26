import type { RouterOutputs } from "@sans/api";
import type { PaywallVariant } from "./types";

export const APP_STORE_URL =
	"https://apps.apple.com/app/apple-store/id6747602157?pt=127014439&ct=web_funnel&mt=8";

export const APP_STORE_RATING = process.env.NEXT_PUBLIC_APP_STORE_RATING ?? "4.7";
export const COLLECTOR_COUNT = process.env.NEXT_PUBLIC_COLLECTOR_COUNT ?? "230,000+";
export const SCANNED_VALUE = process.env.NEXT_PUBLIC_SCANNED_VALUE ?? "$50M+";

export const TRIAL_DAYS = Number(process.env.NEXT_PUBLIC_STRIPE_TRIAL_DAYS ?? "3");

export const DEFAULT_PAYWALL_VARIANT: PaywallVariant = "trial";

/** Launch-offer urgency. The countdown is per-session (resets on a fresh visit)
 * and frames the discounted launch pricing as expiring. */
export const OFFER_DURATION_MS = 20 * 60 * 1000;
export const OFFER_TIMER_KEY = "relic_paywall_offer_ts";

/** The launch promo shown as pre-applied at the top of the paywall. */
export const LAUNCH_PROMO_CODE = process.env.NEXT_PUBLIC_LAUNCH_PROMO_CODE ?? "LAUNCH";

/** A coupon validated by the backend against the live Stripe account. Shape
 * mirrors `stripe.validatePromoCode`'s `coupon` return. */
export interface AppliedCoupon {
	code: string;
	promotionCodeId: string;
	percentOff: number | null;
	amountOff: number | null;
	durationLabel: string;
}

export interface Testimonial {
	quote: string;
	name: string;
	initials: string;
	color: string;
	role: string;
	metric: string;
}

export const RESELLER_TESTIMONIAL: Testimonial = {
	quote:
		"I took one photo and in three seconds I had the manufacturer, history, value, and several sources. Game changer for my reselling business.",
	name: "Nicole M.",
	initials: "NM",
	color: "bg-amber-200 text-amber-800",
	role: "Reseller",
	metric: "ID'd in 3 seconds",
};

export const COLLECTOR_TESTIMONIAL: Testimonial = {
	quote:
		"I was about to give away an old lamp but Relic told me it was worth $500. I can't believe how well this works!",
	name: "Tim G.",
	initials: "TG",
	color: "bg-blue-200 text-blue-800",
	role: "Collector",
	metric: "$500 save",
};

export const ACCURACY_TESTIMONIAL: Testimonial = {
	quote:
		"Way more precise than any other app out there. Simple, to the point, and the identifications are actually correct.",
	name: "Quinn S.",
	initials: "QS",
	color: "bg-rose-200 text-rose-800",
	role: "Antique enthusiast",
	metric: "Most accurate app",
};

/** Live pricing for one plan, read from the Stripe price the charge path uses. */
export type PaywallPlanPricing = RouterOutputs["stripe"]["getPaywallPricing"][number];
export type PlanId = PaywallPlanPricing["plan"];

/**
 * One "Relic Pro" product, two billing intervals. Amount and interval come from the
 * live Stripe price at runtime (see `getPaywallPricing`), so the funnel can't show a
 * price we don't charge — only the struck-through anchor below is local.
 */
export interface PlanDefinition {
	id: PlanId;
	amountCents: number;
	/** "Regular" anchor shown struck-through to frame the launch discount — an
	 * intentional marketing anchor, not a real Stripe price. */
	regularCents: number;
	interval: "year" | "month";
}

/** Per-plan launch anchor (the struck-through price). Not a Stripe value. */
export const PLAN_REGULAR_CENTS: Record<PlanId, number> = {
	annual: 7999,
	monthly: 999,
};

/** Merge the live Stripe pricing with the local display anchor. */
export function toPlanDefinition(pricing: PaywallPlanPricing): PlanDefinition {
	return {
		id: pricing.plan,
		amountCents: pricing.amountCents,
		interval: pricing.interval,
		regularCents: PLAN_REGULAR_CENTS[pricing.plan],
	};
}
