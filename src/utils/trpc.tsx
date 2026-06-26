// Mock tRPC client — the entire backend boundary for the local funnel.
//
// In the source app this file wired a real tRPC client typed against `@sans/api`.
// Here every procedure the funnel calls is replaced with a canned response so the
// full quiz -> results -> paywall -> auth -> success flow runs with zero network.
// Swap this file out (and restore the real httpBatchLink) to point at a live backend.

type Mutation<TVars, TResult> = {
	mutate: (vars: TVars) => void;
	mutateAsync: (vars: TVars) => Promise<TResult>;
	isPending: boolean;
	isError: boolean;
	error: null;
	data: undefined;
	reset: () => void;
};

type Query<TData> = {
	data: TData;
	isLoading: boolean;
	isPending: boolean;
	isError: boolean;
	error: null;
	refetch: () => Promise<{ data: TData }>;
};

function mockUserId(): string {
	return `user_mock_${Math.random().toString(36).slice(2, 10)}`;
}

function makeMutation<TVars, TResult>(
	impl: (vars: TVars) => TResult | Promise<TResult>,
): { useMutation: () => Mutation<TVars, TResult> } {
	return {
		useMutation: () => ({
			mutate: (vars: TVars) => {
				void Promise.resolve(impl(vars));
			},
			mutateAsync: async (vars: TVars) => impl(vars),
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
			reset: () => {},
		}),
	};
}

function makeQuery<TData>(data: TData): { useQuery: () => Query<TData> } {
	return {
		useQuery: () => ({
			data,
			isLoading: false,
			isPending: false,
			isError: false,
			error: null,
			refetch: async () => ({ data }),
		}),
	};
}

const PAYWALL_PRICING = [
	{ plan: "annual" as const, amountCents: 2999, interval: "year" as const },
	{ plan: "monthly" as const, amountCents: 499, interval: "month" as const },
];

export const api = {
	funnel: {
		trackEvent: makeMutation((_vars: Record<string, unknown>) => ({ success: true as const })),
		linkAttribution: makeMutation((_vars: Record<string, unknown>) => ({ success: true as const })),
	},
	auth: {
		anonymous: makeMutation((_vars?: void) => ({ userId: mockUserId(), token: "mock_token" })),
		requestEmailCode: makeMutation((_vars: { email: string }) => ({ success: true as const })),
		verifyEmailCode: makeMutation((vars: { email: string; code: string }) => ({
			userId: mockUserId(),
			email: vars.email,
		})),
	},
	stripe: {
		createSetupIntent: makeMutation((_vars: { userId: string }) => ({
			clientSecret: "seti_mock_secret",
			customerId: "cus_mock",
			setupIntentId: "seti_mock",
		})),
		getPaywallPricing: makeQuery(PAYWALL_PRICING),
		validatePromoCode: makeMutation((vars: { code: string }) => ({
			valid: true as const,
			code: vars.code.toUpperCase(),
			promotionCodeId: "promo_mock",
			coupon: {
				percentOff: 50,
				amountOff: null,
				duration: "once",
				durationInMonths: null,
			},
		})),
		createSubscription: makeMutation((_vars: Record<string, unknown>) => ({
			subscriptionId: "sub_mock",
		})),
	},
};
