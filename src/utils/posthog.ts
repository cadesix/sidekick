type IdentifyProps = Record<string, string | number | boolean | null | undefined>;

interface PosthogLike {
	identify: (distinctId?: string, properties?: IdentifyProps) => void;
}

const STORAGE_KEY = "posthog_last_identify_v1";

const arePropsEqual = (a?: IdentifyProps, b?: IdentifyProps) => {
	const aKeys = Object.keys(a ?? {});
	const bKeys = Object.keys(b ?? {});
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	for (const key of aKeys) {
		if ((a ?? {})[key] !== (b ?? {})[key]) {
			return false;
		}
	}
	return true;
};

export const identifyOnce = (
	posthog: PosthogLike,
	distinctId: string,
	properties?: IdentifyProps,
) => {
	const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
	const last: { id: string; props: IdentifyProps } | null = raw ? JSON.parse(raw) : null;
	if (last && last.id === distinctId && arePropsEqual(last.props, properties)) {
		console.log("identifyOnce", distinctId, properties, "already identified");
		return;
	}
	console.log("identifyOnce", distinctId, properties);
	posthog.identify(distinctId, properties);
	if (typeof window !== "undefined") {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ id: distinctId, props: properties ?? {} }),
		);
	}
};
