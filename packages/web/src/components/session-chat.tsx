import { useEffect, useRef, useState } from "react";
import { LuArrowUp, LuChevronDown } from "react-icons/lu";
import { SidekickAvatar } from "./sidekick-avatar";
import { track } from "./sidekick-analytics";
import {
	completeSession,
	saveSessionProgress,
	sessionFor,
	sessionState,
	type SessionDef,
} from "./sidekick-sessions";

// The guided-session runner — a session's OWN chat window (docs/guided-sessions.md).
// Scripted asks, free-form answers, one LLM acknowledgment per beat (with a
// single optional probe), progress persisted after every answer so the user
// can dive out (chevron) and back in via the main chat's continue card.
// Ends with the extraction pass → recap → "did i get that right?" → rewards.

type Msg = { role: "bot" | "user"; text: string };
type Phase = "asking" | "answer" | "probe" | "extracting" | "confirm" | "done";

function sidekickName(): string {
	try {
		return JSON.parse(localStorage.getItem("sidekick_profile_v1") ?? "{}")?.name || "sidekick";
	} catch {
		return "sidekick";
	}
}

// one short in-voice reaction to an answer (optionally with ONE follow-up question)
async function fetchAck(def: SessionDef, ask: string, answer: string, probe: boolean): Promise<string | null> {
	const system = `you are ${sidekickName()}, a warm lowercase internet-native friend running a short get-to-know-you chat. the user just answered your question. reply with ONE short specific reaction to what they said (max 18 words)${
		probe ? ", then ask ONE short follow-up question about it" : ". do NOT ask a question"
	}. ${def.sensitive ? "the topic is personal: be gentle, never pry, never joke at their expense. " : ""}no capital letters, no em-dash.`;
	try {
		const r = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ system, name: sidekickName(), messages: [{ role: "user", content: `you asked: ${ask}\nthey answered: ${answer}` }] }),
		});
		const data = await r.json();
		return typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : null;
	} catch {
		return null;
	}
}

// the extraction pass: transcript + schema → fields, notes, and the recap line
async function fetchExtraction(
	def: SessionDef,
	transcript: string,
): Promise<{ fields: Record<string, string>; notes: { tag: string; text: string }[]; recap: string } | null> {
	const system = `you extract structured profile data from a get-to-know-you chat transcript. respond with ONLY valid JSON, no fences, in this shape:
{"fields": {…}, "notes": [{"tag": "…", "text": "…"}], "recap": "…"}
- "fields" keys MUST be from: ${def.schema.fields.join(", ") || "(none)"} — short lowercase values, omit anything the user didn't clearly say
- "notes" tags MUST be from: ${def.schema.notes.join(", ")} — text is a short quote-like capture of the user's own words
- "recap" is a 1-2 sentence playful readback of what you learned, as a lowercase internet-native friend, ending with "locked in 🔒". no em-dash.`;
	try {
		const r = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ system, name: sidekickName(), messages: [{ role: "user", content: transcript }] }),
		});
		const data = await r.json();
		const raw = String(data.reply ?? "").replace(/^```(json)?/m, "").replace(/```\s*$/m, "").trim();
		const parsed = JSON.parse(raw);
		return {
			fields: parsed.fields ?? {},
			notes: Array.isArray(parsed.notes) ? parsed.notes : [],
			recap: typeof parsed.recap === "string" ? parsed.recap : "ok, got all of that. locked in 🔒",
		};
	} catch {
		return null;
	}
}

export function SessionChat({
	island,
	onClose,
	onDone,
}: {
	island: string;
	// dive out mid-session (progress is already saved per beat)
	onClose: () => void;
	// completed: host closes the window and may offer travel
	onDone: () => void;
}) {
	const def = sessionFor(island);
	const [msgs, setMsgs] = useState<Msg[]>([]);
	const [typing, setTyping] = useState(false);
	const [phase, setPhase] = useState<Phase>("asking");
	const [input, setInput] = useState("");
	const listRef = useRef<HTMLDivElement>(null);
	const beatIdx = useRef(0);
	const answers = useRef<string[]>([]);
	const transcriptExtra = useRef(""); // recap corrections appended for re-extraction
	const extraction = useRef<{ fields: Record<string, string>; notes: { tag: string; text: string }[] } | null>(null);
	const confirmedOnce = useRef(false);
	const timers = useRef<number[]>([]);

	useEffect(() => {
		const el = listRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [msgs, typing, phase]);
	useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
	const later = (fn: () => void, ms: number) => {
		const t = window.setTimeout(fn, ms);
		timers.current.push(t);
	};
	const showBotThen = (texts: string[], after: () => void) => {
		let i = 0;
		const next = () => {
			if (i >= texts.length) return after();
			const text = texts[i];
			i += 1;
			setTyping(true);
			later(() => {
				setTyping(false);
				setMsgs((m) => [...m, { role: "bot", text }]);
				later(next, 300);
			}, 600);
		};
		next();
	};

	const askBeat = (idx: number) => {
		if (!def) return;
		beatIdx.current = idx;
		setPhase("asking");
		track("step_viewed", { flow: "session", session: def.id, step_id: def.beats[idx].id, index: idx });
		showBotThen(def.beats[idx].ask, () => setPhase("answer"));
	};

	// kick off: fresh intro, or a "where were we" resume at the saved beat
	useEffect(() => {
		if (!def) return;
		const st = sessionState(def.id);
		answers.current = [...st.answers];
		const resuming = st.beat > 0 && !st.done;
		track(resuming ? "flow_resumed" : "flow_started", { flow: "session", session: def.id });
		if (resuming) {
			showBotThen(["oh hey, you're back!!", "where were we… right:"], () => askBeat(st.beat));
		} else {
			showBotThen(def.intro, () => askBeat(0));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [def?.id]);

	const transcript = () =>
		(def?.beats ?? [])
			.map((b, i) => (answers.current[i] ? `q: ${b.ask.join(" ")}\na: ${answers.current[i]}` : null))
			.filter(Boolean)
			.join("\n\n") + transcriptExtra.current;

	const finish = async () => {
		if (!def) return;
		setPhase("extracting");
		setTyping(true);
		const ex = await fetchExtraction(def, transcript());
		setTyping(false);
		extraction.current = ex ? { fields: ex.fields, notes: ex.notes } : { fields: {}, notes: [] };
		showBotThen([ex?.recap ?? "ok, got all of that. locked in 🔒", "did i get that right?"], () => setPhase("confirm"));
	};

	const nextBeat = () => {
		if (!def) return;
		const n = beatIdx.current + 1;
		if (n < def.beats.length) askBeat(n);
		else void finish();
	};

	const celebrate = () => {
		if (!def) return;
		completeSession(def.id, extraction.current?.fields ?? {}, extraction.current?.notes ?? []);
		track("flow_completed", { flow: "session", session: def.id });
		showBotThen([`and that's ${def.title.toLowerCase()} done. +${def.bond}% bond 🧡`, "the island's open. let's gooo 🏝️"], () =>
			setPhase("done"),
		);
	};

	const submit = async () => {
		if (!def) return;
		const text = input.trim();
		if (!text || typing || phase === "asking" || phase === "extracting") return;
		setInput("");
		setMsgs((m) => [...m, { role: "user", text }]);

		if (phase === "confirm") {
			const yes = /^(y|yes|yep|yeah|yup|sure|correct|mostly|all good|👍|✓)/i.test(text) && text.length < 24;
			if (yes || confirmedOnce.current) return celebrate();
			confirmedOnce.current = true;
			transcriptExtra.current += `\n\ncorrection from the user about your summary: ${text}`;
			setPhase("extracting");
			setTyping(true);
			const ex = await fetchExtraction(def, transcript());
			setTyping(false);
			if (ex) extraction.current = { fields: ex.fields, notes: ex.notes };
			showBotThen([ex ? `ok fixed. ${ex.recap}` : "ok noted!!", "good now?"], () => setPhase("confirm"));
			return;
		}

		const beat = def.beats[beatIdx.current];
		const prev = answers.current[beatIdx.current];
		answers.current[beatIdx.current] = prev ? `${prev} / ${text}` : text;
		saveSessionProgress(def.id, beatIdx.current, answers.current);
		track("step_completed", { flow: "session", session: def.id, step_id: beat.id });

		if (phase === "probe") {
			// the one follow-up is answered — move on with a tiny scripted beat
			showBotThen(["got it got it"], nextBeat);
			return;
		}
		// decide: probe once on substantial answers (never on sensitive sessions)
		const wantProbe = !!beat.probe && !def.sensitive && text.length >= 12;
		setPhase("asking");
		setTyping(true);
		const ack = await fetchAck(def, beat.ask.join(" "), text, wantProbe);
		setTyping(false);
		if (ack) {
			setMsgs((m) => [...m, { role: "bot", text: ack }]);
			if (wantProbe) {
				setPhase("probe");
				return;
			}
			later(nextBeat, 350);
		} else {
			// offline/errored: keep the session moving with a scripted ack
			showBotThen(["love that"], nextBeat);
		}
	};

	const skip = () => {
		if (!def || typing || phase === "asking" || phase === "extracting" || phase === "confirm" || phase === "done") return;
		const beat = def.beats[beatIdx.current];
		setMsgs((m) => [...m, { role: "user", text: "skip" }]);
		answers.current[beatIdx.current] = "(skipped)";
		saveSessionProgress(def.id, beatIdx.current, answers.current);
		track("step_completed", { flow: "session", session: def.id, step_id: beat.id, answer: "(skipped)" });
		showBotThen([def.sensitive ? "all good 🤍" : "skipping, no stress"], nextBeat);
	};

	if (!def) return null;
	const progress = Math.min(beatIdx.current + 1, def.beats.length);

	return (
		<div className="flex h-full flex-col bg-white">
			{/* header: session title + progress + dive-out */}
			<div className="flex shrink-0 items-center justify-between border-b border-[#111]/10 px-4 py-2.5">
				<div>
					<div className="text-[15px] font-extrabold text-neutral-900">{def.title}</div>
					<div className="text-[12px] font-medium text-neutral-400">
						{phase === "done" ? "complete!" : `${progress} of ${def.beats.length}`}
					</div>
				</div>
				<button
					onClick={onClose}
					aria-label="Leave session"
					className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-500 active:bg-neutral-200"
				>
					<LuChevronDown className="h-5 w-5" strokeWidth={2.5} />
				</button>
			</div>

			<div ref={listRef} className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 pt-4">
				{msgs.map((m, i) =>
					m.role === "bot" ? (
						<div key={i} className="flex max-w-[85%] items-end gap-2">
							<SidekickAvatar className="h-8 w-8 shrink-0 select-none object-contain" alt="Sidekick" />
							<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug text-[#111]">
								{m.text}
							</div>
						</div>
					) : (
						<div key={i} className="max-w-[80%] animate-fade-up self-end">
							<div className="rounded-3xl rounded-br-md bg-[#E9E9EC] px-4 py-2.5 text-[15px] leading-snug text-[#111]">
								{m.text}
							</div>
						</div>
					),
				)}
				{typing ? (
					<div className="flex items-end gap-2">
						<SidekickAvatar className="h-8 w-8 shrink-0 object-contain" />
						<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug">
							<span className="ellipsis-dots inline-block w-7 text-[#111]/40">&#8203;</span>
						</div>
					</div>
				) : null}
			</div>

			<div className="shrink-0 border-t border-[#111]/10 px-3 pb-7 pt-2">
				{phase === "done" ? (
					<button
						onClick={onDone}
						className="mx-auto block w-full max-w-md rounded-full bg-[#7A5AF8] py-3.5 text-[16px] font-bold text-white shadow-[0_4px_0_#5638c6] transition-all duration-100 active:translate-y-[3px] active:shadow-[0_1px_0_#5638c6]"
					>
						See the island
					</button>
				) : (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void submit();
						}}
						className="flex items-center gap-2"
					>
						<button
							type="button"
							onClick={skip}
							className="shrink-0 rounded-full px-2.5 py-2 text-[13px] font-semibold text-[#111]/35 active:text-[#111]/60"
						>
							skip
						</button>
						<input
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={phase === "confirm" ? "yep / fix something…" : "message"}
							className="min-w-0 flex-1 rounded-full bg-[#F0F0F2] px-5 py-3 text-[15px] text-[#111] placeholder:text-[#111]/40 focus:outline-none"
						/>
						<button
							type="submit"
							disabled={!input.trim() || typing || phase === "asking" || phase === "extracting"}
							className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F2C94C] transition disabled:opacity-40"
						>
							<LuArrowUp className="h-5 w-5 text-white" strokeWidth={3} />
						</button>
					</form>
				)}
			</div>
		</div>
	);
}
