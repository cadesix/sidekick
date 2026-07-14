import { useEffect, useRef, useState } from "react";
import { OnboardingChat } from "./components/funnel/onboarding-chat";
import { SidekickAvatar } from "./components/sidekick-avatar";
import { SKIN_COLORS, applySkin } from "./components/sidekick-skin";
import { setOnboardingPhase } from "./components/sidekick-profile";
import { track } from "./components/sidekick-analytics";
import {
	SidekickCanvas,
	type CanvasFraming,
	type SidekickCanvasHandle,
} from "./components/sidekick-canvas";

// Onboarding: a locked 3D stage (evening meadow) played as a scripted,
// screen-by-screen flow. The camera eases toward the current `framing`; the
// character's jump-in entrance, camera shakes, and live recolor come through
// the canvas ref handle.
//
// 1. welcome      — wide empty evening lawn, "Ready to meet your sidekick?"
// 2. askName      — camera zooms in, centered "what's your name?" input
// 3+4. reveal     — camera to hero, sidekick JUMPS in, "Hey {name}, meet your sidekick!"
// 4b. customize   — pick the sidekick's color (live recolor)
// 5. nameSidekick — centered "what's his name?" input
// 6. notif        — an iMessage-style banner drops in (push-prompt slot)
// 7. chat         — tap the banner → he holds up the phone, scripted chat → free chat

// Establishing shot: pulled back on the empty lawn (character parked below).
const WIDE_FRAMING: CanvasFraming = { pos: [0, 1.9, 9.5], target: [0, 0.5, 0], fov: 43 };
// Name step: zoomed in toward where the sidekick will land (still empty).
const NAME_FRAMING: CanvasFraming = { pos: [0, 1.2, 7.2], target: [0, 0.5, 0], fov: 39 };
// Hero: full-body, centered (matches /home4's hero shot).
const HERO_FRAMING: CanvasFraming = { pos: [0, 0.66, 4.2], target: [0, 0.56, 0], fov: 41.1 };
// Chat: pulled back + low so he sits high in the sky above the chat sheet,
// holding the phone (matches /home4's chat framing).
const CHAT_FRAMING: CanvasFraming = { pos: [0, 1.0, 7.7], target: [0, -0.55, 0], fov: 31 };
// Chat: the sheet covers ~80%, so the camera pulls way back and aims low —
// the whole standing character composes into the top sliver (home5 pattern).
const SLIVER_FRAMING: CanvasFraming = { pos: [0, 1.6, 13], target: [0, -2.0, 0], fov: 30 };

type Phase = "welcome" | "askName" | "reveal" | "customize" | "nameSidekick" | "notif" | "chat";

// Declarative entry state per phase: what the scene must look like when you
// land on a phase COLD (deep link / reload-resume), independent of whatever
// cinematic normally plays on the way in. goTo() applies it, persists the
// step, and emits the funnel event — transitions are just the fancy path.
const PHASE_ORDER: Phase[] = ["welcome", "askName", "reveal", "customize", "nameSidekick", "notif", "chat"];
const PHASES: Record<Phase, { framing: CanvasFraming; characterVisible: boolean }> = {
	welcome: { framing: WIDE_FRAMING, characterVisible: false },
	askName: { framing: NAME_FRAMING, characterVisible: false },
	reveal: { framing: HERO_FRAMING, characterVisible: true },
	customize: { framing: HERO_FRAMING, characterVisible: true },
	nameSidekick: { framing: HERO_FRAMING, characterVisible: true },
	notif: { framing: HERO_FRAMING, characterVisible: true },
	chat: { framing: SLIVER_FRAMING, characterVisible: true },
};

// reload-resume: the saved step is honored for a few hours; after that the
// user gets the welcome moment again (and analytics counts a fresh attempt)
const RESUME_KEY = "sidekick_onboarding_step_v1";
const RESUME_TTL_MS = 6 * 60 * 60 * 1000;

function loadResume(): Phase | null {
	try {
		const raw = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null") as { phase: Phase; ts: number } | null;
		if (!raw || !PHASE_ORDER.includes(raw.phase)) return null;
		return Date.now() - raw.ts < RESUME_TTL_MS ? raw.phase : null;
	} catch {
		return null;
	}
}

function loadProfileField(field: string): string {
	try {
		return (JSON.parse(localStorage.getItem("sidekick_profile_v1") ?? "{}") as Record<string, string>)[field] ?? "";
	} catch {
		return "";
	}
}

// Selectable sidekick colors — the shared skin palette (also used by the
// Appearance sheet at home).
const COLORS = SKIN_COLORS;

const BTN =
	"w-full max-w-md mx-auto block py-4 rounded-full bg-[#4F46F0] text-white text-[17px] font-bold shadow-[0_5px_0_0_#372FC9] transition active:translate-y-[3px] active:shadow-[0_2px_0_0_#372FC9] disabled:opacity-60 disabled:active:translate-y-0 disabled:active:shadow-[0_5px_0_0_#372FC9]";
const FIELD =
	"w-full px-5 py-4 rounded-2xl bg-white/90 backdrop-blur text-[17px] font-medium text-[#111] placeholder:text-[#111]/35 focus:outline-none focus:ring-2 focus:ring-[#4F46F0]/40 shadow-sm";

// Persist a profile field as soon as its step produces it, so a resumed
// session has everything earlier steps collected.
function saveProfileField(field: string, value: string) {
	try {
		const raw = localStorage.getItem("sidekick_profile_v1");
		const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		localStorage.setItem("sidekick_profile_v1", JSON.stringify({ ...prev, [field]: value }));
	} catch {
		// ignore storage errors
	}
}

// Persist the sidekick's name where the onboarding chat reads it from.
function saveSidekickName(name: string) {
	try {
		const raw = localStorage.getItem("sidekick_profile_v1");
		const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		localStorage.setItem("sidekick_profile_v1", JSON.stringify({ ...prev, name }));
	} catch {
		// ignore storage errors
	}
}

// A titled text field, centered on screen, with its own CTA.
function NameEntry({
	title,
	placeholder,
	cta,
	onSubmit,
}: {
	title: string;
	placeholder: string;
	cta: string;
	onSubmit: (value: string) => void;
}) {
	const [value, setValue] = useState("");
	const can = value.trim().length > 0;
	const submit = () => can && onSubmit(value.trim());
	return (
		<div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-8 text-center">
			<div className="w-full max-w-md animate-fade-up">
				<h1 className="text-[40px] font-extrabold leading-[0.98] tracking-[-0.035em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
					{title}
				</h1>
				<input
					autoFocus
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") submit();
					}}
					placeholder={placeholder}
					maxLength={24}
					className={`${FIELD} mt-6 text-center`}
				/>
				<button className={`${BTN} mt-3`} disabled={!can} onClick={submit}>
					{cta}
				</button>
			</div>
		</div>
	);
}

// iOS/iMessage-style notification that drops down from the top and persists.
function NotificationBanner({
	show,
	sender,
	onTap,
}: {
	show: boolean;
	sender: string;
	onTap: () => void;
}) {
	return (
		<div className="absolute inset-x-0 top-0 z-30 px-3 pt-[6svh] pointer-events-none">
			<button
				onClick={onTap}
				className={`pointer-events-auto w-full max-w-md mx-auto flex items-center gap-3 rounded-[22px] bg-white px-3.5 py-3 text-left ring-1 ring-black/5 transition-all duration-500 ease-out ${
					show ? "translate-y-0 opacity-100" : "-translate-y-[160%] opacity-0"
				}`}
			>
				<SidekickAvatar className="w-10 h-10 rounded-[10px] object-contain shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-2">
						<span className="text-[14px] font-semibold text-[#111] truncate">{sender}</span>
						<span className="text-[12px] text-[#111]/40 shrink-0">now</span>
					</div>
					<p className="text-[14px] leading-snug text-[#111]/80">
						Your sidekick is trying to send you a message! turn on notifications so you can get it
					</p>
				</div>
			</button>
		</div>
	);
}

export default function Onboarding() {
	const canvasRef = useRef<SidekickCanvasHandle | null>(null);
	// resume a fresh-enough session at its saved step, with its saved outputs
	const initialPhase = useRef<Phase>(loadResume() ?? "welcome").current;
	const [phase, setPhase] = useState<Phase>(initialPhase);
	const [framing, setFraming] = useState<CanvasFraming>(PHASES[initialPhase].framing);
	// Locks CTAs / hides overlays while a camera move / jump cinematic is playing.
	const [animating, setAnimating] = useState(false);
	const [userName, setUserName] = useState(() => loadProfileField("userName"));
	const [sidekickName, setSidekickName] = useState(() => loadProfileField("name"));
	const [color, setColor] = useState(COLORS[0].id);
	const [notifIn, setNotifIn] = useState(initialPhase === "notif");
	const [chatMounted, setChatMounted] = useState(initialPhase === "chat");

	// every phase change lands here: persist the step, apply its entry framing,
	// and emit the funnel event — one choke point, no per-handler tracking
	const goTo = (next: Phase, opts?: { keepFraming?: boolean }) => {
		setPhase(next);
		if (!opts?.keepFraming) setFraming(PHASES[next].framing);
		try {
			localStorage.setItem(RESUME_KEY, JSON.stringify({ phase: next, ts: Date.now() }));
		} catch {
			// ignore storage failures
		}
		track("step_viewed", { flow: "onboarding-3d", step_id: next, index: PHASE_ORDER.indexOf(next) });
	};

	// flow start / resume events (once per mount)
	useEffect(() => {
		if (initialPhase === "welcome") track("flow_started", { flow: "onboarding-3d" });
		else track("flow_resumed", { flow: "onboarding-3d", step_id: initialPhase });
		track("step_viewed", { flow: "onboarding-3d", step_id: initialPhase, index: PHASE_ORDER.indexOf(initialPhase) });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// 1 → 2: zoom the empty shot in toward where the sidekick will appear.
	const startNaming = () => {
		if (animating) return;
		setAnimating(true);
		setFraming(NAME_FRAMING);
		window.setTimeout(() => {
			goTo("askName");
			setAnimating(false);
		}, 700);
	};

	// 2 → 3+4: ease to the hero framing, build suspense, then he jumps into frame.
	const submitUserName = (name: string) => {
		if (animating) return;
		setUserName(name);
		saveProfileField("userName", name);
		track("step_completed", { flow: "onboarding-3d", step_id: "askName", answer: "name-entered" });
		setAnimating(true);
		goTo("reveal"); // clears the input now; reveal copy waits for !animating
		canvasRef.current?.shake({ amp: 0.06, duration: 1.4, mode: "build" });
		window.setTimeout(() => canvasRef.current?.jumpIn({ duration: 800 }), 1100);
		window.setTimeout(() => setAnimating(false), 2100);
		setOnboardingPhase("met-sidekick");
	};

	// 4 → 4b: customize his color (camera stays on the hero framing).
	const toCustomize = () => goTo("customize");
	const pickColor = (c: (typeof COLORS)[number]) => {
		setColor(c.id);
		canvasRef.current?.setColors(c.body, c.shadow); // live recolor
		applySkin(c); // persist + regenerate avatars
		track("step_completed", { flow: "onboarding-3d", step_id: "customize", answer: c.id });
	};

	// 4b → 5: name him (hero framing, centered input).
	const toNameSidekick = () => goTo("nameSidekick");

	// 5 → 6: drop the notification banner in.
	const submitSidekickName = (name: string) => {
		setSidekickName(name);
		saveSidekickName(name);
		track("step_completed", { flow: "onboarding-3d", step_id: "nameSidekick", answer: "name-entered" });
		goTo("notif");
		// NOTE: slot for the real push-notification permission prompt.
		window.setTimeout(() => setNotifIn(true), 300);
	};

	// 6 → 7: tap the banner → he lifts the phone (holdingPhone) + chat opens.
	const openChat = () => {
		setChatMounted(true);
		track("step_completed", { flow: "onboarding-3d", step_id: "notif", answer: "banner-tapped" });
		goTo("chat");
	};

	const sender = sidekickName.trim() || "Sidekick";

	return (
		<div className="relative h-[100svh] overflow-hidden bg-white select-none">
			{/* Locked evening stage — persists across every phase. Character parked
			    below the frame until the reveal jump; holds the phone in chat. */}
			<SidekickCanvas
				handleRef={canvasRef}
				className="absolute inset-0"
				framing={framing}
				timeOfDay="evening"
				cameraDrag={false}
				hidden={!PHASES[initialPhase].characterVisible}
				holdingPhone={phase === "chat"}
			/>

			{/* 1. Welcome */}
			{phase === "welcome" && !animating ? (
				<>
					<div className="absolute inset-x-0 top-[16svh] z-20 px-8 text-center pointer-events-none">
						<div className="animate-fade-up max-w-md mx-auto">
							<h1 className="text-[52px] font-extrabold leading-[0.98] tracking-[-0.035em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
								Welcome!
							</h1>
							<p className="mt-3 text-[20px] leading-snug text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
								Ready to meet your sidekick?
							</p>
						</div>
					</div>
					<div className="absolute inset-x-0 bottom-0 z-20 px-7 pb-10">
						<button className={BTN} disabled={animating} onClick={startNaming}>
							let's go
						</button>
					</div>
				</>
			) : null}

			{/* 2. What's your name? */}
			{phase === "askName" && !animating ? (
				<NameEntry
					key="askName"
					title="what's your name?"
					placeholder="your name"
					cta="continue"
					onSubmit={submitUserName}
				/>
			) : null}

			{/* 3+4. Sidekick jumped in — "Hey {name}, meet your sidekick!" */}
			{phase === "reveal" && !animating ? (
				<>
					<div className="absolute inset-x-0 top-[9svh] z-20 px-8 text-center animate-fade-up pointer-events-none">
						<h1 className="text-[38px] font-extrabold leading-[1.0] tracking-[-0.035em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
							Hey {userName || "there"}, meet your sidekick!
						</h1>
					</div>
					<div className="absolute inset-x-0 bottom-0 z-20 px-7 pb-10">
						<button className={BTN} onClick={toCustomize}>
							continue
						</button>
					</div>
				</>
			) : null}

			{/* 4b. Customize — pick a color */}
			{phase === "customize" && !animating ? (
				<>
					<div className="absolute inset-x-0 top-[8svh] z-20 px-8 text-center animate-fade-up pointer-events-none">
						<h1 className="text-[36px] font-extrabold leading-[1.0] tracking-[-0.035em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
							Customize your sidekick
						</h1>
						<p className="mt-2 text-[17px] text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
							pick a color
						</p>
					</div>
					<div className="absolute inset-x-0 bottom-0 z-20 px-7 pb-10">
						<div className="max-w-md mx-auto w-full">
							<div className="flex justify-center gap-3.5 mb-6">
								{COLORS.map((c) => (
									<button
										key={c.id}
										onClick={() => pickColor(c)}
										aria-label={c.id}
										className={`w-11 h-11 rounded-full transition active:scale-90 ${
											color === c.id
												? "ring-4 ring-white ring-offset-2 ring-offset-[#4F46F0]"
												: "ring-2 ring-white/70"
										}`}
										style={{ backgroundColor: c.body }}
									/>
								))}
							</div>
							<button className={BTN} onClick={toNameSidekick}>
								continue
							</button>
						</div>
					</div>
				</>
			) : null}

			{/* 5. What's his name? */}
			{phase === "nameSidekick" && !animating ? (
				<NameEntry
					key="nameSidekick"
					title="what's his name?"
					placeholder="name your sidekick"
					cta="continue"
					onSubmit={submitSidekickName}
				/>
			) : null}

			{/* 6. Notification banner (drops down from the top) */}
			{phase === "notif" ? (
				<NotificationBanner show={notifIn} sender={sender} onTap={openChat} />
			) : null}

			{/* 7. Chat — the real conversational chat (home5's sliver layout): the
			    sidekick opens by asking what the user wants to work on, so goal
			    discovery happens naturally in conversation instead of a form */}
			{chatMounted ? (
				<div className="absolute inset-x-0 bottom-0 top-[20%] z-40 animate-sheet-up overflow-hidden rounded-t-[28px] bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.22)]">
					<OnboardingChat
						onDone={() => {
							setOnboardingPhase("first-chat");
							track("flow_completed", { flow: "onboarding-3d" });
							window.location.href = "/home4";
						}}
					/>
				</div>
			) : null}
		</div>
	);
}
