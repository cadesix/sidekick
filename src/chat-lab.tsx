import { useEffect, useRef, useState } from "react";
import { LuArrowUp, LuHistory, LuRotateCcw, LuSettings2, LuTrash2, LuX } from "react-icons/lu";
import { DEFAULT_SYSTEM_PROMPT } from "./sidekick-prompt";

// Prompt Lab — a plain chat for iterating on the Sidekick system prompt / voice.
// Edit the prompt, send messages, and the chat uses your edited prompt (sent to
// /api/chat as `system`). The current prompt + a full version history persist in
// localStorage, so you can browse and restore earlier prompts.
type Msg = { role: "user" | "assistant"; content: string };
type PromptVersion = { id: string; text: string; savedAt: number };

const PROMPT_KEY = "sidekick_lab_prompt";
const HISTORY_KEY = "sidekick_lab_prompt_history";

function loadPrompt(): string {
	try {
		return localStorage.getItem(PROMPT_KEY) || DEFAULT_SYSTEM_PROMPT;
	} catch {
		return DEFAULT_SYSTEM_PROMPT;
	}
}

function loadHistory(): PromptVersion[] {
	try {
		const raw = localStorage.getItem(HISTORY_KEY);
		return raw ? (JSON.parse(raw) as PromptVersion[]) : [];
	} catch {
		return [];
	}
}

function newId(): string {
	try {
		return crypto.randomUUID().slice(0, 8);
	} catch {
		return `${Date.now()}`;
	}
}

function timeAgo(ts: number): string {
	const s = Math.floor((Date.now() - ts) / 1000);
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

export default function ChatLab() {
	const [prompt, setPrompt] = useState(loadPrompt);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(prompt);
	const [history, setHistory] = useState<PromptVersion[]>(loadHistory);
	const [editorTab, setEditorTab] = useState<"edit" | "history">("edit");
	const [messages, setMessages] = useState<Msg[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = listRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
				body: JSON.stringify({ messages: next, system: prompt }),
			});
			const data = await r.json();
			const reply =
				typeof data.reply === "string" && data.reply.trim()
					? data.reply
					: data?.error
						? `⚠️ ${data.error}`
						: "hmm, no reply — try again?";
			setMessages((m) => [...m, { role: "assistant", content: reply }]);
		} catch {
			setMessages((m) => [...m, { role: "assistant", content: "⚠️ connection error" }]);
		} finally {
			setLoading(false);
		}
	};

	const openEditor = () => {
		setDraft(prompt);
		setEditorTab("edit");
		setEditing(true);
	};

	function persistHistory(next: PromptVersion[]) {
		setHistory(next);
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
		} catch {
			// ignore
		}
	}

	const savePrompt = () => {
		const text = draft;
		setPrompt(text);
		try {
			localStorage.setItem(PROMPT_KEY, text);
		} catch {
			// ignore
		}
		// Append a version (skip if identical to the most recent save).
		if (history[0]?.text.trim() !== text.trim()) {
			persistHistory([{ id: newId(), text, savedAt: Date.now() }, ...history]);
		}
		setMessages([]); // start a fresh chat so the new voice is tested cleanly
		setEditing(false);
	};

	// Restore a past version into the editor so it can be reviewed and saved.
	const restoreVersion = (v: PromptVersion) => {
		setDraft(v.text);
		setEditorTab("edit");
	};
	const deleteVersion = (id: string) => {
		persistHistory(history.filter((v) => v.id !== id));
	};

	const isCustom = prompt.trim() !== DEFAULT_SYSTEM_PROMPT.trim();

	return (
		<div className="relative h-full overflow-hidden bg-white">
			<div className="h-full flex flex-col">
				<header className="shrink-0 flex items-center px-4 py-3 border-b border-[#111]/10">
					<span className="text-[16px] font-extrabold text-[#111]">Prompt Lab</span>
					{isCustom ? (
						<span className="ml-2 w-2 h-2 rounded-full bg-[#E8A33D]" title="edited prompt" />
					) : null}
				</header>

				<div
				ref={listRef}
				className="no-scrollbar flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3"
			>
				{messages.length === 0 ? (
					<div className="m-auto max-w-[260px] text-center">
						<p className="text-[15px] font-semibold text-[#111]/45">
							Say something to test the voice.
						</p>
						<p className="mt-1 text-[13px] text-[#111]/35">
							Tap <span className="font-bold">Prompt</span> to edit the system prompt and iterate.
						</p>
					</div>
				) : null}
				{messages.map((m, i) =>
					m.role === "assistant" ? (
						<div key={i} className="flex items-end gap-2 max-w-[85%]">
							<img
								src="/sidekick-pfp.webp"
								alt="Sidekick"
								className="w-8 h-8 object-contain shrink-0 select-none"
								draggable={false}
							/>
							<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug text-[#111] whitespace-pre-wrap">
								{m.content}
							</div>
						</div>
					) : (
						<div key={i} className="self-end max-w-[80%]">
							<div className="rounded-3xl rounded-br-md bg-[#E9E9EC] px-4 py-2.5 text-[15px] leading-snug text-[#111] whitespace-pre-wrap">
								{m.content}
							</div>
						</div>
					),
				)}
				{loading ? (
					<div className="flex items-end gap-2">
						<img src="/sidekick-pfp.webp" alt="" aria-hidden="true" className="w-8 h-8 object-contain shrink-0" draggable={false} />
						<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-3">
							<span className="ellipsis-dots inline-flex items-center h-5 w-7 text-[18px] leading-none text-[#111]/40" />
						</div>
					</div>
				) : null}
			</div>

			<div className="shrink-0 px-3 pt-2 pb-4 border-t border-[#111]/10">
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
						className="w-11 h-11 rounded-full bg-[#111] flex items-center justify-center shrink-0 transition disabled:opacity-40"
					>
						<LuArrowUp className="w-5 h-5 text-white" strokeWidth={3} />
					</button>
				</form>
			</div>

			</div>

			<button
				onClick={openEditor}
				className="absolute top-3 right-4 z-40 flex items-center gap-1.5 rounded-full bg-[#111] text-white text-[13px] font-bold pl-3 pr-3.5 py-2 active:scale-95 transition"
			>
				<LuSettings2 className="w-4 h-4" />
				Prompt
			</button>

			{/* System prompt editor — bottom sheet */}
			{editing ? (
				<div
					className="absolute inset-0 z-50 flex flex-col bg-black/30"
					onClick={() => setEditing(false)}
				>
					<div
						className="mt-auto flex flex-col bg-white rounded-t-2xl max-h-[88%] shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between px-3 py-2.5 border-b border-[#111]/10">
							<div className="flex items-center gap-1">
								<button
									onClick={() => setEditorTab("edit")}
									className={`px-3 py-1.5 rounded-full text-[13px] font-bold transition ${
										editorTab === "edit" ? "bg-[#111] text-white" : "text-[#111]/55 active:bg-[#111]/5"
									}`}
								>
									Editor
								</button>
								<button
									onClick={() => setEditorTab("history")}
									className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-bold transition ${
										editorTab === "history" ? "bg-[#111] text-white" : "text-[#111]/55 active:bg-[#111]/5"
									}`}
								>
									<LuHistory className="w-3.5 h-3.5" />
									History{history.length ? ` (${history.length})` : ""}
								</button>
							</div>
							<button
								onClick={() => setEditing(false)}
								className="w-8 h-8 rounded-full flex items-center justify-center text-[#111]/50 active:bg-[#111]/5"
							>
								<LuX className="w-5 h-5" />
							</button>
						</div>

						{editorTab === "edit" ? (
							<>
								<textarea
									value={draft}
									onChange={(e) => setDraft(e.target.value)}
									spellCheck={false}
									className="flex-1 min-h-[280px] resize-none px-4 py-3 text-[13.5px] leading-relaxed font-mono text-[#111] focus:outline-none"
								/>
								<div className="flex items-center gap-2 px-4 py-3 border-t border-[#111]/10">
									<button
										onClick={() => setDraft(DEFAULT_SYSTEM_PROMPT)}
										className="flex items-center gap-1.5 text-[13px] font-semibold text-[#111]/55 active:text-[#111]"
									>
										<LuRotateCcw className="w-4 h-4" />
										Reset to default
									</button>
									<div className="flex-1" />
									<button
										onClick={() => setEditing(false)}
										className="px-4 py-2 rounded-full text-[14px] font-semibold text-[#111]/55"
									>
										Cancel
									</button>
									<button
										onClick={savePrompt}
										className="px-5 py-2 rounded-full bg-[#111] text-white text-[14px] font-bold active:scale-95 transition"
									>
										Save
									</button>
								</div>
							</>
						) : (
							<div className="flex-1 min-h-[280px] overflow-y-auto px-3 py-3 space-y-2.5">
								{history.length === 0 ? (
									<div className="m-auto max-w-[260px] py-10 text-center">
										<p className="text-[14px] font-semibold text-[#111]/45">No saved versions yet.</p>
										<p className="mt-1 text-[12px] text-[#111]/35">
											Edit the prompt and tap <span className="font-bold">Save</span> — each save is kept
											here.
										</p>
									</div>
								) : (
									history.map((v) => {
										const isCurrent = v.text.trim() === prompt.trim();
										return (
											<div
												key={v.id}
												className={`rounded-xl border p-3 ${
													isCurrent ? "border-[#E8A33D] bg-[#FBEFC9]/30" : "border-[#111]/10"
												}`}
											>
												<div className="mb-1.5 flex items-center justify-between gap-2">
													<span className="text-[11px] font-semibold text-[#111]/45">
														{timeAgo(v.savedAt)}
														{isCurrent ? " · current" : ""}
													</span>
													<div className="flex items-center gap-1">
														<button
															onClick={() => restoreVersion(v)}
															className="px-2.5 py-1 rounded-full bg-[#111] text-white text-[11px] font-bold active:scale-95 transition"
														>
															Restore
														</button>
														<button
															onClick={() => deleteVersion(v.id)}
															aria-label="delete version"
															className="w-7 h-7 rounded-full flex items-center justify-center text-[#111]/40 active:bg-[#111]/5"
														>
															<LuTrash2 className="w-3.5 h-3.5" />
														</button>
													</div>
												</div>
												<p className="line-clamp-3 whitespace-pre-wrap font-mono text-[12px] leading-snug text-[#111]/70">
													{v.text}
												</p>
											</div>
										);
									})
								)}
							</div>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
