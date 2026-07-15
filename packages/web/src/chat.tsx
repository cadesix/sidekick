import { useEffect, useRef, useState } from "react";
import { SidekickAvatar } from "./components/sidekick-avatar";
import { clearUnread, GREETING, subscribeInbox, type ChatMsg } from "./components/sidekick-inbox";
import { LuArrowUp } from "react-icons/lu";

type Msg = ChatMsg;

const STORAGE_KEY = "sidekick_chat_v1";

function loadMessages(greeting: Msg): Msg[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length) return parsed as Msg[];
		}
	} catch {
		// ignore corrupt storage
	}
	return [greeting];
}

// the character's chosen name, for [sidekick.name] in the global system prompt
function sidekickName(): string {
	try {
		return JSON.parse(localStorage.getItem("sidekick_profile_v1") ?? "{}")?.name || "sidekick";
	} catch {
		return "sidekick";
	}
}

export function Chat({
	peekIn = true,
	transparentTop = false,
	peekPop = false,
	seed,
	greeting,
	resume,
}: {
	peekIn?: boolean;
	transparentTop?: boolean;
	peekPop?: boolean;
	// a message auto-sent from the user once on mount — e.g. the Goals sheet
	// opening a goal in chat ("I want to talk about my goal: …")
	seed?: string;
	// an in-progress guided session: rendered as a pinned continue card above
	// the input (dive back in without the session polluting this thread)
	resume?: { label: string; sub: string; onContinue: () => void };
	// overrides the sidekick's opening line when there's no saved history
	// (e.g. onboarding starts by asking about goals)
	greeting?: string;
}) {
	const [messages, setMessages] = useState<Msg[]>(() =>
		loadMessages(greeting ? { role: "assistant", content: greeting } : GREETING),
	);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	// first layout jumps to the bottom instantly (open already at the bottom of the
	// chat); later message additions animate smoothly
	const didInitScroll = useRef(false);

	// Sidekick-initiated pushes (sidekick-inbox): with the chat on screen they
	// append live and count as read immediately; while unmounted they land in
	// localStorage and get picked up by loadMessages on the next open.
	useEffect(() => {
		clearUnread();
		return subscribeInbox((text) => {
			setMessages((m) => [...m, { role: "assistant", content: text }]);
			clearUnread();
		});
	}, []);

	// Persist the conversation across reloads / tab switches.
	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
		} catch {
			// ignore
		}
	}, [messages]);

	useEffect(() => {
		// Scroll only the message list — never scrollIntoView (which can scroll
		// ancestors/the page and visibly nudge the UI behind the sheet). On open,
		// jump instantly so it just appears at the bottom (no scroll animation).
		const el = listRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: didInitScroll.current ? "smooth" : "auto" });
		didInitScroll.current = true;
	}, [messages, loading]);

	const sendText = async (raw: string) => {
		const text = raw.trim();
		if (!text || loading) return;
		const next: Msg[] = [...messages, { role: "user", content: text }];
		setMessages(next);
		setInput("");
		setLoading(true);
		try {
			const r = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ messages: next, name: sidekickName() }),
			});
			const data = await r.json();
			const reply =
				typeof data.reply === "string" && data.reply.trim()
					? data.reply
					: "hmm, i blanked for a sec — say that again?";
			setMessages((m) => [...m, { role: "assistant", content: reply }]);
		} catch {
			setMessages((m) => [...m, { role: "assistant", content: "ugh, connection hiccup. try again?" }]);
		} finally {
			setLoading(false);
		}
	};
	const send = () => sendText(input);

	// auto-send the seed once (ref-guarded against strict-mode re-runs)
	const seeded = useRef(false);
	useEffect(() => {
		if (seed && !seeded.current) {
			seeded.current = true;
			sendText(seed);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seed]);

	return (
		<div className={`h-full flex flex-col ${transparentTop ? "" : "bg-[#FBEFC9]"}`}>
			{/* Peeking Sidekick header (only when requested; /home4 uses the real
			    3D character peeking over instead) */}
			{peekIn ? (
				<div className="shrink-0 flex justify-center px-4 pt-3">
					<img
						src="/chat-header.webp"
						alt="Sidekick"
						className={`w-44 object-contain relative z-10 mb-[-22px] select-none ${
							peekPop ? "animate-peek-pop" : "opacity-100 transition-opacity duration-200 delay-75"
						}`}
						draggable={false}
					/>
				</div>
			) : null}

			{/* White chat container with rounded top corners */}
			<div className="flex-1 min-h-0 bg-white rounded-t-[32px] flex flex-col overflow-hidden">
				<div ref={listRef} className="no-scrollbar flex-1 min-h-0 overflow-y-auto px-4 pt-9 pb-3 flex flex-col gap-3">
				{messages.map((m, i) =>
					m.role === "assistant" ? (
						<div key={i} className="flex items-end gap-2 max-w-[85%]">
							<SidekickAvatar className="w-8 h-8 object-contain shrink-0 select-none" alt="Sidekick" />
							<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug text-[#111]">
								{m.content}
							</div>
						</div>
					) : (
						<div key={i} className="self-end max-w-[80%]">
							<div className="rounded-3xl rounded-br-md bg-[#E9E9EC] px-4 py-2.5 text-[15px] leading-snug text-[#111]">
								{m.content}
							</div>
						</div>
					),
				)}
				{loading ? (
					<div className="flex items-end gap-2">
						<SidekickAvatar className="w-8 h-8 object-contain shrink-0" />
						{/* Sized exactly like a one-line message bubble so the swap to text doesn't shift the list. */}
						<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug">
							<span className="ellipsis-dots inline-block w-7 text-[#111]/40">&#8203;</span>
						</div>
					</div>
				) : null}
			</div>

			<div className="px-3 pt-2 pb-3 border-t border-[#111]/10">
				{resume ? (
					<button
						type="button"
						onClick={resume.onContinue}
						className="mb-2 flex w-full items-center justify-between rounded-2xl bg-[#FBEFC9] px-4 py-2.5 text-left shadow-[0_3px_0_rgba(0,0,0,0.08)] transition-all duration-100 active:translate-y-[2px] active:shadow-[0_1px_0_rgba(0,0,0,0.08)]"
					>
						<div className="min-w-0">
							<div className="truncate text-[14px] font-bold text-[#111]">{resume.label}</div>
							<div className="text-[12px] font-medium text-[#111]/50">{resume.sub}</div>
						</div>
						<span className="ml-3 shrink-0 rounded-full bg-[#111] px-3 py-1 text-[12px] font-bold text-white">
							Continue
						</span>
					</button>
				) : null}
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void send();
					}}
					className="flex items-center gap-2"
				>
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="message"
						className="flex-1 rounded-full bg-[#F0F0F2] px-5 py-3 text-[15px] text-[#111] placeholder:text-[#111]/40 focus:outline-none"
					/>
					<button
						type="submit"
						disabled={!input.trim() || loading}
						className="w-11 h-11 rounded-full bg-[#F2C94C] flex items-center justify-center shrink-0 transition disabled:opacity-40"
					>
						<LuArrowUp className="w-5 h-5 text-white" strokeWidth={3} />
					</button>
				</form>
			</div>
		</div>
		</div>
	);
}
