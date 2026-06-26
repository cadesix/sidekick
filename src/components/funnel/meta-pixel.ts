declare global {
	interface Window {
		fbq?: (
			action: string,
			event: string,
			params?: Record<string, unknown>,
			options?: { eventID: string },
		) => void;
	}
}

export function trackPixelEvent(eventName: string, params?: Record<string, unknown>): string {
	const eventId =
		typeof crypto !== "undefined" && crypto.randomUUID
			? crypto.randomUUID()
			: `${eventName}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

	if (typeof window !== "undefined" && window.fbq) {
		window.fbq("track", eventName, params ?? {}, { eventID: eventId });
	}

	return eventId;
}
