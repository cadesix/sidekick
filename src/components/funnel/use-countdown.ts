import { useState } from "react";
import { useInterval } from "usehooks-ts";
import { OFFER_DURATION_MS, OFFER_TIMER_KEY } from "./constants";

/** Reads (or starts) the per-session launch-offer countdown. Anchoring the
 * start time in sessionStorage keeps the timer stable across step navigation
 * and refreshes within a single visit. */
function readRemaining(): number {
	if (typeof window === "undefined") {
		return OFFER_DURATION_MS;
	}
	const stored = sessionStorage.getItem(OFFER_TIMER_KEY);
	if (stored) {
		return Math.max(0, OFFER_DURATION_MS - (Date.now() - Number(stored)));
	}
	sessionStorage.setItem(OFFER_TIMER_KEY, String(Date.now()));
	return OFFER_DURATION_MS;
}

export function useCountdown() {
	const [remaining, setRemaining] = useState(readRemaining);

	useInterval(() => setRemaining(readRemaining()), remaining > 0 ? 1000 : null);

	return {
		minutes: Math.floor(remaining / 60000),
		seconds: Math.floor((remaining % 60000) / 1000),
	};
}
