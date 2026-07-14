import { useEffect, useRef, useState } from "react";
import { SidekickAvatar } from "../sidekick-avatar";
import { GOAL_OPTIONS } from "../../home";
import { BTN_PRIMARY } from "./constants";
import { track } from "../sidekick-analytics";

// Guided onboarding chat — scripted (quick-reply chips anchored bottom-right),
// not the free-form AI chat, but written as a CONVERSATION: the sidekick sets
// the scene, reacts to every choice, reasons the user toward each conclusion
// (pick one concrete action, make it sustainably frequent), and closes with a
// recap of the plan they built together. Goal picks persist to
// sidekick_goals_v1, plan answers to sidekick_plan_v1.

type Msg = { role: "bot" | "user"; text: string };
type Opt = { label: string; value?: string };
type Prompt = { id: string; messages: string[]; options: Opt[]; ack?: (answer: string) => string[] };

const MAX_GOALS = 3;

// Per-goal script: a scene-setting "why" that frames the question, the "how"
// (action item), and a cadence ask that pushes for sustainable over ambitious.
const GOAL_PLANS: Record<
	string,
	{ why: string[]; how: { q: string; options: string[] }; cadence: { q: string; options: string[] } }
> = {
	"get-fit": {
		why: [
			"the secret with fitness isn't motivation, it's picking ONE thing you'd actually do on a random tuesday.",
			"so let's get specific.",
		],
		how: { q: "what's your thing gonna be?", options: ["Go to the gym", "Run", "Play a sport", "Home workouts"] },
		cadence: { q: "how many times a week? be honest, not ambitious lol", options: ["2×", "3×", "5×", "Every day"] },
	},
	"sleep-better": {
		why: [
			"sleep is lowkey the cheat code. every other goal gets easier when you're not running on empty.",
			"and the whole game is just a consistent bedtime.",
		],
		how: { q: "what time do you wanna be asleep by?", options: ["10:00 PM", "11:00 PM", "12:00 AM"] },
		cadence: { q: "every night, or just when work's the next day?", options: ["Every day", "Weekdays"] },
	},
	"stop-procrastinating": {
		why: [
			"ok real talk about procrastination: willpower is fake, structure is real.",
			"we just need a system that starts tasks for you before your brain can argue.",
		],
		how: { q: "which system sounds most like you?", options: ["Time-block my day", "Pomodoro sessions", "One task at a time"] },
		cadence: { q: "how many focus sessions a day feels doable?", options: ["1", "2", "3+"] },
	},
	"stop-doomscrolling": {
		why: [
			"the scroll hole is real and it's designed to be lol. you don't need to delete everything.",
			"you just need a ceiling we can actually enforce together.",
		],
		how: { q: "what's a screen-time ceiling you could live with?", options: ["Under 1h", "Under 2h", "Under 3h"] },
		cadence: { q: "want me to check in on it daily or just weekdays?", options: ["Every day", "Weekdays"] },
	},
	"social-skills": {
		why: [
			"social skills are pure reps. nobody's born charming, they just practice more.",
			"tiny consistent reps beat big scary leaps every time.",
		],
		how: { q: "what rep do you wanna practice?", options: ["Reach out to a friend", "Join a group", "Practice conversations"] },
		cadence: { q: "how many times a week?", options: ["2×", "3×", "Every day"] },
	},
	"manage-stress": {
		why: [
			"stress builds up when there's no release valve. the goal isn't becoming a monk lol.",
			"it's one small daily reset that actually fits your life.",
		],
		how: { q: "what's your reset gonna be?", options: ["Meditate", "Journal", "Breathing exercises", "Take walks"] },
		cadence: { q: "how often can you realistically do it?", options: ["3×", "5×", "Every day"] },
	},
	"read-more": {
		why: [
			"the secret to reading more is attaching it to a moment you already have.",
			"'free time' is a myth, stolen minutes are real.",
		],
		how: { q: "where do the pages fit for you?", options: ["Set a page goal", "Read before bed", "Audiobooks"] },
		cadence: { q: "how many days a week?", options: ["3", "5", "Every day"] },
	},
	"be-productive": {
		why: [
			"productivity isn't doing more, it's deciding what matters before the day starts eating you.",
			"so we pick a system and protect it.",
		],
		how: { q: "which one fits how your brain works?", options: ["Daily top 3 tasks", "Time-blocking", "Deep work sessions"] },
		cadence: { q: "how many days a week are we running it?", options: ["3×", "5×", "Every day"] },
	},
};

// a reaction for every goal pick, so choosing feels heard rather than logged
const GOAL_REACTIONS: Record<string, string> = {
	"get-fit": "gym era incoming 💪 love it",
	"sleep-better": "honestly? the highest-leverage one on the list",
	"stop-procrastinating": "the classic. we've all been there lol",
	"stop-doomscrolling": "respect for even admitting it, most people won't",
	"social-skills": "love that. this one pays off literally everywhere",
	"manage-stress": "big one. your brain's gonna thank you",
	"read-more": "a reading arc!! here for it",
	"be-productive": "ok let's get you locked in",
};

function loadSidekickName(): string {
	try {
		const raw = localStorage.getItem("sidekick_profile_v1");
		const name = raw ? (JSON.parse(raw) as { name?: string }).name : "";
		return name && name !== "Sidekick" ? name : "";
	} catch {
		return "";
	}
}

function loadUserName(): string {
	try {
		return (JSON.parse(localStorage.getItem("sidekick_profile_v1") ?? "{}") as { userName?: string }).userName ?? "";
	} catch {
		return "";
	}
}

function buildPlanPrompts(goals: { value: string; label: string }[]): Prompt[] {
	const prompts: Prompt[] = [];
	goals.forEach((g, i) => {
		const plan = GOAL_PLANS[g.value];
		if (!plan) return;
		prompts.push({
			id: `${g.value}-how`,
			messages: [
				i === 0 ? `ok, let's turn these into an actual plan. ${g.label.toLowerCase()} first.` : `alright, ${g.label.toLowerCase()}.`,
				...plan.why,
				plan.how.q,
			],
			options: plan.how.options.map((label) => ({ label })),
			ack: (a) => [`${a.toLowerCase()}. that's concrete, i can work with that`],
		});
		prompts.push({
			id: `${g.value}-cadence`,
			messages: [plan.cadence.q],
			options: plan.cadence.options.map((label) => ({ label })),
			ack: (a) => [`${a.toLowerCase()} it is 🔒 small and consistent beats big and never, every time`],
		});
	});
	prompts.push({
		id: "reminder",
		messages: [
			"ok last bit of setup. here's how this actually works:",
			"you live your life, i check in, you tell me how it went. no judgment either way.",
			"when should i come knocking?",
		],
		options: [{ label: "Daily" }, { label: "Weekdays" }, { label: "Weekly" }],
	});
	prompts.push({
		id: "push",
		messages: [
			"and real talk, the difference between this working and you forgetting i exist is one notification 🔔",
			"can i ping your phone?",
		],
		options: [
			{ label: "Turn on notifications", value: "enable" },
			{ label: "Maybe later", value: "later" },
		],
	});
	return prompts;
}

export function OnboardingChat({ onDone }: { onDone: () => void }) {
	const [msgs, setMsgs] = useState<Msg[]>([]);
	const [options, setOptions] = useState<Opt[] | null>(null);
	const [typing, setTyping] = useState(false);
	const [finished, setFinished] = useState(false);

	const listRef = useRef<HTMLDivElement>(null);
	// goal-picking stage state, then the plan prompt queue
	const picking = useRef(true);
	const chosen = useRef<{ value: string; label: string }[]>([]);
	const prompts = useRef<Prompt[]>([]);
	const stepRef = useRef(0);
	const answers = useRef<Record<string, string>>({});
	const timers = useRef<number[]>([]);

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

	const goalOptions = (): Opt[] => {
		const remaining = GOAL_OPTIONS.filter((o) => !chosen.current.some((c) => c.value === o.value)).map((o) => ({
			label: o.label,
			value: o.value,
		}));
		return chosen.current.length ? [...remaining, { label: "That's it for now", value: "done" }] : remaining;
	};

	const runStep = (idx: number) => {
		stepRef.current = idx;
		setOptions(null);
		showBotThen(prompts.current[idx].messages, () => setOptions(prompts.current[idx].options));
	};

	// goal picking complete → persist + build the plan queue
	const finishPicking = () => {
		picking.current = false;
		try {
			localStorage.setItem("sidekick_goals_v1", JSON.stringify(chosen.current.map((c) => c.value)));
		} catch {
			// ignore storage failures
		}
		prompts.current = buildPlanPrompts(chosen.current);
		runStep(0);
	};

	// the closing recap: read the conclusions back as one plan
	const finishFlow = () => {
		const recap = chosen.current.map((g) => {
			const how = answers.current[`${g.value}-how`] ?? "";
			const cadence = answers.current[`${g.value}-cadence`] ?? "";
			return `${g.label.toLowerCase()}: ${how.toLowerCase()}, ${cadence.toLowerCase()}`;
		});
		showBotThen(
			[
				"ok. recap time. here's the plan WE just built:",
				...recap,
				"that's not a wish list, that's a system. and honestly? it's a good one.",
				"you handle the showing up, i'll handle the reminding. deal? 🤝",
			],
			() => setFinished(true),
		);
	};

	// Kick off: scene-setting intro, then goal discovery.
	useEffect(() => {
		const name = loadSidekickName();
		const user = loadUserName();
		showBotThen(
			[
				name ? `i'm ${name} and we're officially a team 🎉` : "yay, we're officially a team 🎉",
				`so here's the deal${user ? `, ${user}` : ""}. i'm basically the friend who actually remembers what you said you'd do.`,
				"we're about to figure out what you wanna work on, and turn it into stuff you'd actually do on a normal tuesday. then i check in and keep you honest.",
				"no pressure, no judgment. just us.",
				"so, real talk. what's been on your mind? what do you wanna work on?",
			],
			() => setOptions(goalOptions()),
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const select = (opt: Opt) => {
		setOptions(null);
		setMsgs((m) => [...m, { role: "user", text: opt.label }]);
		track("step_completed", {
			flow: "onboarding-3d",
			step_id: picking.current ? "chat-goal-pick" : `chat-${prompts.current[stepRef.current]?.id ?? "?"}`,
			answer: opt.value ?? opt.label,
		});

		if (picking.current) {
			if (opt.value === "done") {
				showBotThen(["ok good list. i like it."], finishPicking);
				return;
			}
			chosen.current.push({ value: opt.value ?? opt.label, label: opt.label });
			const reaction = GOAL_REACTIONS[opt.value ?? ""] ?? `${opt.label.toLowerCase()}, love that`;
			if (chosen.current.length >= MAX_GOALS) {
				showBotThen([reaction, "and that's three. that's a strong list, more than that and we'd be lying to ourselves lol"], finishPicking);
			} else {
				showBotThen(
					[reaction, chosen.current.length === 1 ? "anything else on your mind? or is that the one" : "anything else? one more slot if you want it"],
					() => setOptions(goalOptions()),
				);
			}
			return;
		}

		const idx = stepRef.current;
		const cur = prompts.current[idx];
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
		const proceed = () => {
			if (idx + 1 < prompts.current.length) runStep(idx + 1);
			else finishFlow();
		};
		if (cur.ack) showBotThen(cur.ack(opt.label), () => later(proceed, 200));
		else later(proceed, 260);
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
							<SidekickAvatar className="w-8 h-8 object-contain shrink-0 select-none" alt="Sidekick" />
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
						<SidekickAvatar className="w-8 h-8 object-contain shrink-0" />
						{/* Sized exactly like a one-line message bubble so the swap to text doesn't shift the list. */}
						<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-2.5 text-[15px] leading-snug">
							<span className="ellipsis-dots inline-block w-7 text-[#111]/40">&#8203;</span>
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
					<div className="no-scrollbar flex max-h-[38vh] flex-col items-end gap-2 overflow-y-auto animate-fade-up">
						<div className="text-[12px] font-medium text-[#111]/40 pr-1">Choose your reply</div>
						{options.map((o) => (
							<button
								key={o.label}
								onClick={() => select(o)}
								className="rounded-3xl rounded-br-md bg-[#E9E9EC] px-4 py-2.5 text-[15px] leading-snug text-[#111] text-right transition active:scale-95"
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
