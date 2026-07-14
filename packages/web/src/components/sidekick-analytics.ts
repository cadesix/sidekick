// Analytics facade — the ONLY module components may import for tracking.
// Vendor/transport specifics live behind track(); the RN port swaps the
// transport (and the storage shim) without touching a single call site.
//
// Events are queued durably in storage and flushed in batches, fire-and-forget:
// an app killed mid-onboarding is exactly the drop-off we want to measure, so
// events must survive the session. Nothing here ever blocks or throws into UI.

const ANON_KEY = "sidekick_anon_id"; // deliberately NOT in PROFILE_KEYS — survives resets
const QUEUE_KEY = "sidekick_analytics_queue_v1";
const ENDPOINT = "/api/track"; // batch sink; 404 = no backend configured yet
const MAX_QUEUE = 300;

type AnalyticsEvent = {
	event: string;
	ts: number;
	anonId: string;
	variant?: string;
	props: Record<string, unknown>;
};

function anonId(): string {
	try {
		let id = localStorage.getItem(ANON_KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(ANON_KEY, id);
		}
		return id;
	} catch {
		return "anon";
	}
}

// experiment arm from the funnel's session assignment, stamped on every event
function variant(): string | undefined {
	try {
		return JSON.parse(localStorage.getItem("funnel_session") ?? "{}")?.assignment?.variant;
	} catch {
		return undefined;
	}
}

function readQueue(): AnalyticsEvent[] {
	try {
		return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") ?? [];
	} catch {
		return [];
	}
}

function writeQueue(q: AnalyticsEvent[]): void {
	try {
		localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
	} catch {
		// storage blocked — events stay in memory-of-this-call only
	}
}

let flushing = false;
async function flush(): Promise<void> {
	if (flushing) return;
	const batch = readQueue();
	if (!batch.length) return;
	flushing = true;
	try {
		const r = await fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ events: batch }),
			keepalive: true,
		});
		// delivered — or no sink exists yet (404): don't hoard forever in dev
		if (r.ok || r.status === 404) {
			const q = readQueue();
			writeQueue(q.slice(batch.length));
		}
	} catch {
		// offline — keep queued for the next flush
	} finally {
		flushing = false;
	}
}

let wired = false;
function wireFlush(): void {
	if (wired) return;
	wired = true;
	window.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") void flush();
	});
}

// Fire-and-forget. Never await this from UI code.
export function track(event: string, props: Record<string, unknown> = {}): void {
	try {
		const e: AnalyticsEvent = { event, ts: Date.now(), anonId: anonId(), variant: variant(), props };
		writeQueue([...readQueue(), e]);
		if (import.meta.env.DEV) console.debug("[track]", event, props);
		wireFlush();
		void flush();
	} catch {
		// analytics must never break the app
	}
}
