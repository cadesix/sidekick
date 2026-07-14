// Sidekick-initiated messages ("text pushes"): lines the character sends the
// user outside a live chat — e.g. reacting to arriving somewhere on the map.
// A push appends straight to the persisted conversation and bumps an unread
// counter; the dock's Messages icon renders the counter as a badge until the
// chat is next opened. Same localStorage + window-event pattern as coins/bond.

export type ChatMsg = { role: "user" | "assistant"; content: string };

// the conversation opener — lives here (not chat.tsx) so a push that lands
// before the first-ever chat open can seed the history without a circular import
export const GREETING: ChatMsg = {
	role: "assistant",
	content: "hey! how's your day going so far — have you had any water yet? 👀",
};

const CHAT_KEY = "sidekick_chat_v1";
export const UNREAD_KEY = "sidekick_unread_v1";
const UNREAD_EVT = "sidekick:unread";
const INBOX_EVT = "sidekick:inbox";

export function loadUnread(): number {
	try {
		const n = parseInt(localStorage.getItem(UNREAD_KEY) ?? "0", 10);
		return Number.isFinite(n) && n > 0 ? n : 0;
	} catch {
		return 0;
	}
}

function setUnread(n: number) {
	try {
		localStorage.setItem(UNREAD_KEY, String(n));
	} catch {
		// ignore
	}
	window.dispatchEvent(new CustomEvent(UNREAD_EVT));
}

// the chat surface calls this when the messages are on screen
export function clearUnread() {
	if (loadUnread() !== 0) setUnread(0);
}

export function subscribeUnread(cb: (n: number) => void): () => void {
	const on = () => cb(loadUnread());
	window.addEventListener(UNREAD_EVT, on);
	return () => window.removeEventListener(UNREAD_EVT, on);
}

// append a sidekick line to the saved conversation + bump unread. A mounted
// Chat also hears the inbox event and appends live (then re-persists the same
// result, so the two paths stay consistent).
export function pushSidekickMessage(text: string) {
	try {
		const raw = localStorage.getItem(CHAT_KEY);
		const parsed = raw ? JSON.parse(raw) : null;
		const msgs: ChatMsg[] = Array.isArray(parsed) && parsed.length ? (parsed as ChatMsg[]) : [GREETING];
		msgs.push({ role: "assistant", content: text });
		localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
	} catch {
		// ignore
	}
	window.dispatchEvent(new CustomEvent(INBOX_EVT, { detail: text }));
	setUnread(loadUnread() + 1);
}

export function subscribeInbox(cb: (text: string) => void): () => void {
	const on = (e: Event) => cb((e as CustomEvent<string>).detail);
	window.addEventListener(INBOX_EVT, on);
	return () => window.removeEventListener(INBOX_EVT, on);
}
