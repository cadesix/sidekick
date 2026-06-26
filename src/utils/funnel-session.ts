import type { FunnelAssignment } from "~/components/funnel/types";

const KEY = "funnel_session";

// The session token lives in the HttpOnly `auth_token` cookie the backend sets;
// only the non-sensitive userId is kept here for the client to read. The pinned
// experiment assignment lives here too so it survives the post-paywall auth redirect.
export interface FunnelSession {
	userId?: string;
	assignment?: FunnelAssignment;
}

export function getFunnelSession(): FunnelSession | null {
	if (typeof window === "undefined") {
		return null;
	}
	const raw = localStorage.getItem(KEY);
	if (!raw) {
		return null;
	}
	try {
		return JSON.parse(raw) as FunnelSession;
	} catch {
		return null;
	}
}

export function setFunnelSession(patch: Partial<FunnelSession>): void {
	if (typeof window === "undefined") {
		return;
	}
	const existing = getFunnelSession() ?? {};
	localStorage.setItem(KEY, JSON.stringify({ ...existing, ...patch }));
}
