// No-op stand-in for `posthog-js`. The funnel calls posthog.capture/alias/identify
// and reads feature flags via getFeatureFlag; locally we disable analytics entirely.
// getFeatureFlag returns undefined so the funnel falls back to its default variant.
const noop = (): void => {};

const handler: ProxyHandler<Record<string, unknown>> = {
	get(_target, prop) {
		if (prop === "getFeatureFlag" || prop === "getFeatureFlagPayload") {
			return () => undefined;
		}
		if (prop === "isFeatureEnabled") {
			return () => false;
		}
		return noop;
	},
};

// Typed as `any` on purpose: it stands in for the posthog-js client surface
// (capture/identify/alias/getFeatureFlag/...) without reproducing its full types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const posthog: any = new Proxy({}, handler);

export default posthog;
