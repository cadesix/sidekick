import { useEffect, useRef, useState } from "react";
import { loadGoals } from "../../home";
import { BTN_PRIMARY } from "./constants";

// Guided onboarding chat — the last onboarding step. The sidekick walks the user
// through turning each chosen goal into a concrete action item + cadence, picks a
// reminder cadence, and offers to turn on push notifications. Scripted (quick-reply
// chips), not the free-form AI chat.

type Msg = { role: "bot" | "user"; text: string };
type Opt = { label: string; value?: string };
type Prompt = { id: string; messages: string[]; options: Opt[] };

// Per-goal: the "how" question (action item) + a cadence / daily check-in criteria.
const GOAL_PLANS: Record<string, { how: { q: string; options: string[] }; cadence: { q: string; options: string[] } }> = {
	"get-fit": {
		how: { q: "How do you want to get fit?", options: ["Go to the gym", "Run", "Play a sport", "Home workouts"] },
		cadence: { q: "How many times a week?", options: ["2×", "3×", "5×", "Every day"] },
	},
	"sleep-better": {
		how: { q: "What time do you want to be asleep by?", options: ["10:00 PM", "11:00 PM", "12:00 AM"] },
		cadence: { q: "I'll check in on your sleep — how often?", options: ["Every day", "Weekdays"] },
	},
	"stop-procrastinating": {
		how: { q: "How will you beat procrastination?", options: ["Time-block my day", "Pomodoro sessions", "One task at a time"] },
		cadence: { q: "How many focus sessions a day?", options: ["1", "2", "3+"] },
	},
	"stop-doomscrolling": {
		how: { q: "What's your daily screen-time limit?", options: ["Under 1h", "Under 2h", "Under 3h"] },
		cadence: { q: "I'll track your screen time — how often?", options: ["Every day", "Weekdays"] },
	},
	"social-skills": {
		how: { q: "How do you want to build social skills?", options: ["Reach out to a friend", "Join a group", "Practice conversations"] },
		cadence: { q: "How many times a week?", options: ["2×", "3×", "Every day"] },
	},
	"manage-stress": {
		how: { q: "How do you want to manage stress?", options: ["Meditate", "Journal", "Breathing exercises", "Take walks"] },
		cadence: { q: "How many times a week?", options: ["3×", "5×", "Every day"] },
	},
	"read-more": {
		how: { q: "How do you want to read more?", options: ["Set a page goal", "Read before bed", "Audiobooks"] },
		cadence: { q: "How many days a week?", options: ["3", "5", "Every day"] },
	},
	"be-productive": {
		how: { q: "How do you want to be more productive?", options: ["Daily top 3 tasks", "Time-blocking", "Deep work sessions"] },
		cadence: { q: "How many times a week?", options: ["3×", "5×", "Every day"] },
	},
};

const INTRO = ["yay — we're officially a team! 🎉", "let's turn your goals into a plan i can actually hold you to."];

function buildPrompts(goals: { value: string; label: string }[]): Prompt[] {
	const prompts: Prompt[] = [];
	for (const g of goals) {
		const plan = GOAL_PLANS[g.value];
		if (!plan) continue;
		prompts.push({ id: `${g.value}-how`, messages: [`first up — ${g.label.toLowerCase()}.`, plan.how.q], options: plan.how.options.map((label) => ({ label })) });
		prompts.push({ id: `${g.value}-cadence`, messages: [plan.cadence.q], options: plan.cadence.options.map((label) => ({ label })) });
	}
	prompts.push({ id: "reminder", messages: ["nice — that's a real plan now 💪", "when should i check in with you?"], options: [{ label: "Daily" }, { label: "Weekdays" }, { label: "Weekly" }] });
	prompts.push({ id: "push", messages: ["last thing — can i send you a nudge so you don't forget? 🔔"], options: [{ label: "Turn on notifications", value: "enable" }, { label: "Maybe later", value: "later" }] });
	return prompts;
}

export function OnboardingChat({ onDone }: { onDone: () => void }) {
	const promptsRef = useRef<Prompt[]>(buildPrompts(loadGoals()));
	const prompts = promptsRef.current;

	const [msgs, setMsgs] = useState<Msg[]>([]);
	const [stepIdx, setStepIdx] = useState(0);
	const [options, setOptions] = useState<Opt[] | null>(null);
	const [typing, setTyping] = useState(false);
	const [finished, setFinished] = useState(false);

	const listRef = useRef<HTMLDivElement>(null);
	const answers = useRef<Record<string, string>>({});
	const timers = useRef<number[]>([]);
	const stepRef = useRef(0);

	// Auto-scroll the list (scoped — never the page).
	useEffect(() => {
		const el = listRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [msgs, options, typing]);

	// Clear any pending timers on unmount.
	useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
	const later = (fn: () => void, ms: number) => {
		const t = window.setTimeout(fn, ms);
		timers.current.push(t);
	};

	// Type out a sequence of bot messages, then run `after`.
	const showBotThen = (texts: string[], after: () => void) => {
		let i = 0;
		const next = () => {
			if (i >= texts.length) {
				after();
				return;
			}
			const text = texts[i];
			i += 1;
			setTyping(true);
			later(() => {
				setTyping(false);
				setMsgs((m) => [...m, { role: "bot", text }]);
				later(next, 320);
			}, 620);
		};
		next();
	};

	const runStep = (idx: number) => {
		stepRef.current = idx;
		setStepIdx(idx);
		setOptions(null);
		showBotThen(prompts[idx].messages, () => setOptions(prompts[idx].options));
	};

	// Kick off: intro, then the first prompt.
	useEffect(() => {
		showBotThen(INTRO, () => runStep(0));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const select = (opt: Opt) => {
		const idx = stepRef.current;
		const cur = prompts[idx];
		setOptions(null);
		setMsgs((m) => [...m, { role: "user", text: opt.label }]);
		answers.current[cur.id] = opt.value ?? opt.label;
		try {
			localStorage.setItem("sidekick_plan_v1", JSON.stringify(answers.current));
		} catch {
			// ignore
		}
		if (cur.id === "push" && opt.value === "enable") {
			try {
				if ("Notification" in window) void Notification.requestPermission();
			} catch {
				// ignore
			}
		}
		if (idx + 1 < prompts.length) {
			later(() => runStep(idx + 1), 260);
		} else {
			later(() => showBotThen(["amazing — your plan's all set 🙌", "let's gooo!"], () => setFinished(true)), 260);
		}
	};

	return (
		<div className="h-full flex flex-col bg-white">
			<div
				ref={listRef}
				className="no-scrollbar flex-1 min-h-0 overflow-y-auto px-4 pt-6 pb-3 flex flex-col gap-3"
			>
				{msgs.map((m, i) =>
					m.role === "bot" ? (
						<div key={i} className="flex items-end gap-2 max-w-[85%]">
							<img
								src="/sidekick-pfp.webp"
								alt="Sidekick"
								className="w-8 h-8 object-contain shrink-0 select-none"
								draggable={false}
							/>
							<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug text-[#111]">
								{m.text}
							</div>
						</div>
					) : (
						<div key={i} className="self-end max-w-[80%] animate-fade-up">
							<div className="rounded-3xl rounded-br-md bg-[#E9E9EC] px-4 py-2.5 text-[15px] leading-snug text-[#111]">
								{m.text}
							</div>
						</div>
					),
				)}
				{typing ? (
					<div className="flex items-end gap-2">
						<img
							src="/sidekick-pfp.webp"
							alt=""
							aria-hidden="true"
							className="w-8 h-8 object-contain shrink-0"
							draggable={false}
						/>
						<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-3">
							<span className="ellipsis-dots inline-flex items-center h-5 w-7 text-[18px] leading-none text-[#111]/40" />
						</div>
					</div>
				) : null}
			</div>

			<div className="shrink-0 px-4 pt-3 pb-7 border-t border-[#111]/10">
				{finished ? (
					<button onClick={onDone} className={BTN_PRIMARY}>
						Enter Sidekick
					</button>
				) : options ? (
					<div className="flex flex-wrap gap-2 justify-end">
						{options.map((o) => (
							<button
								key={o.label}
								onClick={() => select(o)}
								className="rounded-full bg-[#111] text-white text-[15px] font-semibold px-4 py-2.5 transition active:scale-95"
							>
								{o.label}
							</button>
						))}
					</div>
				) : (
					<div className="h-[44px]" />
				)}
			</div>
		</div>
	);
}
