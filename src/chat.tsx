import { useEffect, useRef, useState } from "react";
import { LuArrowUp } from "react-icons/lu";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING: Msg = {
	role: "assistant",
	content: "hey! how's your day going so far — have you had any water yet? 👀",
};

const STORAGE_KEY = "sidekick_chat_v1";

function loadMessages(): Msg[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length) return parsed as Msg[];
		}
	} catch {
		// ignore corrupt storage
	}
	return [GREETING];
}

export function Chat({
	peekIn = true,
	transparentTop = false,
	peekPop = false,
}: {
	peekIn?: boolean;
	transparentTop?: boolean;
	peekPop?: boolean;
}) {
	const [messages, setMessages] = useState<Msg[]>(loadMessages);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	// first layout jumps to the bottom instantly (open already at the bottom of the
	// chat); later message additions animate smoothly
	const didInitScroll = useRef(false);

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

	const send = async () => {
		const text = input.trim();
		if (!text || loading) return;
		const next: Msg[] = [...messages, { role: "user", content: text }];
		setMessages(next);
		setInput("");
		setLoading(true);
		try {
			const r = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ messages: next }),
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
							<img
								src="/sidekick-pfp.webp"
								alt="Sidekick"
								className="w-8 h-8 object-contain shrink-0 select-none"
								draggable={false}
							/>
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
						<img
							src="/sidekick-pfp.webp"
							alt=""
							aria-hidden="true"
							className="w-8 h-8 object-contain shrink-0"
							draggable={false}
						/>
						{/* Sized exactly like a one-line message bubble so the swap to text doesn't shift the list. */}
						<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug">
							<span className="ellipsis-dots inline-block w-7 text-[#111]/40">&#8203;</span>
						</div>
					</div>
				) : null}
			</div>

			<div className="px-3 pt-2 pb-3 border-t border-[#111]/10">
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
