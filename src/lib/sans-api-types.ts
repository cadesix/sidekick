// Minimal replacement for the `@sans/api` type the funnel imported. The funnel only
// used `RouterOutputs["stripe"]["getPaywallPricing"]` (in constants.ts) to derive the
// paywall plan shape, so that's all we reproduce here.
export type RouterOutputs = {
	stripe: {
		getPaywallPricing: {
			plan: "annual" | "monthly";
			amountCents: number;
			interval: "year" | "month";
		}[];
	};
};

export type AppRouter = unknown;
