import { useState } from "react";
import type { IconType } from "react-icons";
import { LuChartNoAxesColumn, LuFlame, LuUser } from "react-icons/lu";
import { Chat } from "./chat";
import { PASTELS } from "./components/funnel/constants";
import { STEPS } from "./components/funnel/manifest";

// The goal options the user chose from in the funnel (single source of truth).
export const GOAL_OPTIONS = (() => {
	const goalsStep = STEPS.find((s) => s.type === "goals");
	return goalsStep && goalsStep.type === "goals" ? goalsStep.question.options : [];
})();

// The goals the user selected during onboarding, persisted by the funnel.
// Falls back to every goal option when nothing's been chosen yet (e.g. dev /home).
export function loadGoals() {
	let values: string[] = [];
	try {
		const raw = localStorage.getItem("sidekick_goals_v1");
		const parsed = raw ? JSON.parse(raw) : null;
		if (Array.isArray(parsed)) values = parsed as string[];
	} catch {
		// ignore corrupt storage
	}
	const chosen = values
		.map((v) => GOAL_OPTIONS.find((o) => o.value === v))
		.filter((o): o is (typeof GOAL_OPTIONS)[number] => Boolean(o));
	return chosen.length ? chosen : GOAL_OPTIONS;
}

type Tab = "stats" | "chat" | "profile";

const NAV: { key: Tab; label: string; Icon?: IconType; img?: string }[] = [
	{ key: "stats", label: "Stats", Icon: LuChartNoAxesColumn },
	{ key: "chat", label: "Chat", img: "/chat-tab.webp" },
	{ key: "profile", label: "Profile", Icon: LuUser },
];

function todayLabel() {
	try {
		return new Date().toLocaleDateString("en-US", {
			weekday: "long",
			month: "long",
			day: "numeric",
		});
	} catch {
		return "Today";
	}
}

function Dashboard() {
	const goals = loadGoals();
	return (
		<div className="relative h-full overflow-hidden">
			{/* Cinematic full-screen backdrop */}
			<img
				src="/home-backdrop.webp"
				alt=""
				aria-hidden="true"
				className="absolute inset-0 w-full h-full object-cover select-none"
				draggable={false}
			/>
			{/* Soft scrim so the header stays legible over the bright sky */}
			<div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/35 to-transparent" />

			{/* Header overlaid on the backdrop */}
			<div className="relative max-w-md mx-auto w-full px-5 pt-7">
				<div className="flex items-start justify-between">
					<div>
						<p className="text-[13px] font-semibold text-white/85 drop-shadow">{todayLabel()}</p>
						<h1 className="mt-0.5 text-[28px] font-extrabold tracking-[-0.02em] text-white drop-shadow-md">
							Good morning
						</h1>
					</div>
					<div className="flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 shadow-sm">
						<LuFlame className="w-4 h-4 text-[#FF9F43]" strokeWidth={2.5} />
						<span className="text-[15px] font-bold text-[#111]">3</span>
					</div>
				</div>
			</div>

			{/* Bottom sheet — rounded top corners sitting above the backdrop */}
			<div className="absolute inset-x-0 bottom-0 top-[46%] bg-white rounded-t-[32px] shadow-[0_-10px_30px_rgba(0,0,0,0.14)] flex flex-col">
				<div className="shrink-0 flex justify-center pt-3 pb-1">
					<div className="w-10 h-1.5 rounded-full bg-[#111]/12" />
				</div>
				<div className="max-w-md mx-auto w-full px-5 pt-2 flex items-baseline justify-between shrink-0">
					<h2 className="text-[18px] font-extrabold text-[#111]">Your goals</h2>
					<span className="text-[13px] font-bold text-[#111]/45">{goals.length}</span>
				</div>
				<div className="flex-1 min-h-0 overflow-y-auto max-w-md mx-auto w-full px-5 pt-3 pb-6">
					<div className="flex flex-col gap-2.5">
						{goals.map((g, i) => (
							<div
								key={g.value}
								style={{ backgroundColor: PASTELS[i % PASTELS.length] }}
								className="flex items-center gap-3 rounded-2xl pl-3 pr-4 py-2.5"
							>
								{g.icon ? (
									<img
										src={g.icon}
										alt=""
										className="w-10 h-10 object-contain shrink-0 select-none mix-blend-multiply"
										draggable={false}
									/>
								) : g.emoji ? (
									<span className="w-10 text-center text-2xl leading-none shrink-0">{g.emoji}</span>
								) : null}
								<span className="flex-1 text-[16px] font-bold text-[#111]">{g.label}</span>
								<div className="flex items-center gap-1.5 shrink-0">
									<LuFlame className="w-4 h-4 text-[#FF9F43]" strokeWidth={2.5} />
									<span className="text-[13px] font-bold text-[#111]/55">0</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function Placeholder({ label }: { label: string }) {
	return (
		<div className="h-full flex items-center justify-center text-[#111]/35 text-[15px] font-bold">
			{label} — coming soon
		</div>
	);
}

export default function Home() {
	const [tab, setTab] = useState<Tab>("chat");

	return (
		<div className="h-[100svh] flex flex-col bg-white">
			<div className="flex-1 min-h-0">
				{tab === "chat" ? <Chat /> : tab === "stats" ? <Dashboard /> : <Placeholder label="Profile" />}
			</div>

			<nav className="relative bg-white overflow-visible shadow-[0_-1px_0_rgba(17,17,17,0.06)]">
				<div className="max-w-md mx-auto flex items-end justify-around px-8 pt-2 pb-5">
					{NAV.map((item) => {
						const active = tab === item.key;
						const tint = active ? "text-[#CB9A2B]" : "text-[#111]/35";
						const isChat = Boolean(item.img);
						return (
							<button
								key={item.key}
								onClick={() => setTab(item.key)}
								className="flex flex-col items-center"
							>
								{isChat ? (
									<img
										src={item.img}
										alt=""
										className="w-16 h-16 object-contain -mt-9"
										draggable={false}
									/>
								) : item.Icon ? (
									<item.Icon className={`w-[26px] h-[26px] ${tint}`} strokeWidth={2.25} />
								) : null}
								<span className={`mt-0.5 text-[12.5px] font-bold ${tint}`}>{item.label}</span>
							</button>
						);
					})}
				</div>
			</nav>
		</div>
	);
}
