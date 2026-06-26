import { type AppliedCoupon, type PlanDefinition } from "./constants";

/** Pure display math so the price shown always equals the price charged. */

export function formatPrice(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

export function perWeek(annualCents: number): string {
	return `$${(annualCents / 100 / 52).toFixed(2)}`;
}

/** Apply a validated Stripe coupon to a cents amount (percent- or amount-off). */
export function applyCoupon(cents: number, coupon: AppliedCoupon | null): number {
	if (!coupon) {
		return cents;
	}
	if (coupon.percentOff) {
		return Math.max(0, Math.round(cents * (1 - coupon.percentOff / 100)));
	}
	if (coupon.amountOff) {
		return Math.max(0, cents - coupon.amountOff);
	}
	return cents;
}

/** Whole-percent discount of `now` against the `regular` anchor. */
export function discountPct(regularCents: number, nowCents: number): number {
	if (regularCents <= 0) {
		return 0;
	}
	return Math.round((1 - nowCents / regularCents) * 100);
}

export function discountLabel(coupon: AppliedCoupon): string {
	if (coupon.percentOff) {
		return `${coupon.percentOff}% off`;
	}
	if (coupon.amountOff) {
		return `${formatPrice(coupon.amountOff)} off`;
	}
	return "Discount applied";
}

export interface PlanDisplay {
	id: PlanDefinition["id"];
	title: string;
	/** Struck-through "regular" anchor. */
	regularLabel: string;
	/** What the customer actually pays now (launch price, after any coupon). */
	nowCents: number;
	nowLabel: string;
	intervalLabel: string;
	perWeekLabel: string;
	discountPct: number;
}

/** Resolve a plan into its display shape, folding in any applied coupon so the
 * launch discount reflects both the standing launch price and the code. */
export function planDisplay(plan: PlanDefinition, coupon: AppliedCoupon | null): PlanDisplay {
	const nowCents = applyCoupon(plan.amountCents, coupon);
	const perWeekCents = plan.interval === "year" ? nowCents : nowCents * 12;
	return {
		id: plan.id,
		title: plan.interval === "year" ? "Annual" : "Monthly",
		regularLabel: formatPrice(plan.regularCents),
		nowCents,
		nowLabel: formatPrice(nowCents),
		intervalLabel: plan.interval === "year" ? "per year" : "per month",
		perWeekLabel: `${perWeek(perWeekCents)}/wk`,
		discountPct: discountPct(plan.regularCents, nowCents),
	};
}
