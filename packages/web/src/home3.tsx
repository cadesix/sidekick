import { useState } from "react";
import { LuChevronDown, LuFlame } from "react-icons/lu";
import { Chat } from "./chat";
import { loadGoals } from "./home";
import { PASTELS } from "./components/funnel/constants";
import { SidekickCanvas } from "./components/sidekick-canvas";

// Home2 with a live Three.js backdrop: the still image is replaced by a 3D
// scene (sky, hill, rigged Sidekick idling) with identical composition.
// Otherwise identical IA to home2: no nav bar. The Stats screen is the index, with a floating chat
// button bottom-right. Tapping it fades the "Your goals" sheet away and slides a
// chat bottom sheet up, while the peeking Sidekick quickly fades in.
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

export default function Home3() {
	const goals = loadGoals();
	const [chatOpen, setChatOpen] = useState(false);
	// `mounted` keeps the sheet in the DOM through its slide-down exit; `peek` drives
	// the quick fade-in of the peeking Sidekick once the sheet is on its way up.
	const [mounted, setMounted] = useState(false);
	const [peek, setPeek] = useState(false);

	const open = () => {
		setMounted(true);
		setChatOpen(true);
		window.setTimeout(() => setPeek(true), 100);
	};
	const close = () => {
		setChatOpen(false);
		setPeek(false);
		window.setTimeout(() => setMounted(false), 400);
	};

	return (
		<div className="relative h-[100svh] overflow-hidden bg-white">
			{/* Above-the-fold strip: full 3D scene (sky, lawn, grass, character).
			    Bleeds a bit past the fold so the sheet's rounded-corner notches
			    reveal grass, not white. */}
			<div className="absolute inset-x-0 top-0 h-[49%] overflow-hidden">
				<SidekickCanvas className="absolute inset-0" />
			</div>
			<div className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/35 to-transparent" />

			{/* Header — fades out as the chat opens */}
			<div
				className={`relative max-w-md mx-auto w-full px-5 pt-7 transition-opacity duration-300 ${
					chatOpen ? "opacity-0" : "opacity-100"
				}`}
			>
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

			{/* "Your goals" sheet — fades out as the chat opens */}
			<div
				className={`absolute inset-x-0 bottom-0 top-[46%] bg-white rounded-t-[32px] flex flex-col transition-opacity duration-300 ${
					chatOpen ? "opacity-0 pointer-events-none" : "opacity-100"
				}`}
			>
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

			{/* Floating chat button (bottom-right) — white, solid 0-blur shadow; fades out while open */}
			<button
				onClick={open}
				aria-label="Talk to Sidekick"
				className={`absolute bottom-6 right-5 z-30 w-[68px] h-[68px] rounded-full bg-white shadow-[0_5px_0_0_rgba(0,0,0,0.16)] flex items-center justify-center transition-all duration-300 active:translate-y-[2px] active:shadow-[0_3px_0_0_rgba(0,0,0,0.16)] ${
					chatOpen ? "opacity-0 scale-75 pointer-events-none" : "opacity-100 scale-100"
				}`}
			>
				<img src="/chat-tab.webp" alt="" className="w-14 h-14 object-contain" draggable={false} />
			</button>

			{/* Chat bottom sheet — mounted only while open (and during its slide-down exit) */}
			{mounted ? (
				<>
					{/* Tap the backdrop strip above the sheet to close */}
					<button
						onClick={close}
						aria-label="Close chat"
						className="absolute inset-x-0 top-0 h-[7%] z-30"
					/>
					<div
						className={`absolute inset-x-0 bottom-0 top-[7%] z-20 ${
							chatOpen ? "animate-sheet-up" : "animate-sheet-down"
						}`}
					>
						<button
							onClick={close}
							aria-label="Close chat"
							className="absolute top-2.5 right-3 z-20 w-9 h-9 rounded-full bg-white/85 shadow-sm flex items-center justify-center active:bg-white"
						>
							<LuChevronDown className="w-5 h-5 text-[#111]/60" strokeWidth={2.5} />
						</button>
						<Chat peekIn={peek} transparentTop peekPop />
					</div>
				</>
			) : null}
		</div>
	);
}
