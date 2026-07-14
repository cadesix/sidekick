import { useEffect, useRef, useState } from "react";
import { LuLock, LuX } from "react-icons/lu";
import { SidekickAvatar } from "./sidekick-avatar";
import { BOND_MAX, loadBond, subscribeBond } from "./sidekick-bond";
import { isSessionDone, isSessionStartable, nextSession, sessionFor, CONTEXT_EVENT } from "./sidekick-sessions";
import type { EnvironmentId } from "./sidekick-biomes";

// A single static map for the world page. The art is a tall ~9:16 island chain —
// it fills the viewport height (cover) over a sky→sea gradient that backs the
// letterbox bands while the art loads.
const MAP_SRC = "/world-map-quests.webp";
const MAP_BG = "linear-gradient(#b795c9, #3e97d9)";

// Circle-mask reveal. The radius eases out (fast → settle) so the *area* revealed
// (∝ r²) doesn't accelerate as it grows. Target 74% ≈ just enough to reach the
// corners (corner distance is ~70.7% of the clip reference), so the deceleration
// lands ON-screen instead of overshooting off-frame. The promo card pops after.
const REVEAL_MS = 380;
const REVEAL_EASE = "cubic-bezier(0.33, 1, 0.68, 1)"; // easeOutCubic — graceful settle, deceleration stays on-screen
const CARD_DELAY = 300; // circle has visually landed by here; then the card pops

// Full-screen "world map" that the dock's Map icon opens. Shows the stylized
// island world with Apple/Google-Maps-style markers over each destination.
// Every island is locked behind ONE guided session (docs/guided-sessions.md):
// complete the session, unlock the island, bond goes up. Frostpeak starts
// open. Tapping a marker opens the destination modal — travel when unlocked,
// the session doorway when locked.

type Area = {
	id: string;
	name: string;
	emoji: string;
	color: string; // marker badge background
	left: string; // % position over the map image
	top: string;
	blurb: string;
	biome: EnvironmentId; // the travel environment this destination renders
};

// positions are % of world-map-quests.webp (941×1672)
const AREAS: Area[] = [
	{ id: "frostpeak", name: "Frostpeak", emoji: "❄️", color: "#cfe6ff", left: "29%", top: "19%", blurb: "Snow-capped summit", biome: "snow" },
	{ id: "pinewood", name: "Pinewood", emoji: "🌲", color: "#8fd18f", left: "73%", top: "28%", blurb: "Evergreen forest", biome: "forest" },
	{ id: "blossom", name: "Blossom Vale", emoji: "🌸", color: "#ffc1dd", left: "29%", top: "49%", blurb: "Cherry-blossom groves", biome: "blossom" },
	{ id: "dunes", name: "Sandy Dunes", emoji: "🏜️", color: "#f2c98a", left: "82%", top: "57%", blurb: "Golden desert canyon", biome: "desert" },
	{ id: "palmcove", name: "Palm Cove", emoji: "🌴", color: "#7fd6b0", left: "24%", top: "73%", blurb: "Tropical palm shore", biome: "tropical" },
	{ id: "ember", name: "Mount Ember", emoji: "🌋", color: "#ff8a5b", left: "65%", top: "79%", blurb: "Smouldering volcano", biome: "volcano" },
];

// island id → travel environment (the session-complete "see the island" hop)
export const AREA_BIOME: Record<string, EnvironmentId> = Object.fromEntries(AREAS.map((a) => [a.id, a.biome]));

export function WorldMap({
	open,
	onClose,
	onChat,
	onTravel,
	onStartSession,
}: {
	open: boolean;
	onClose: () => void;
	onChat?: () => void;
	// travel to an unlocked destination — the host swaps the 3D environment and
	// closes the map (the closing reveal masks the instant world swap)
	onTravel?: (biome: EnvironmentId) => void;
	// open the guided-session window for an island (its unlock key)
	onStartSession?: (island: string) => void;
}) {
	const [selId, setSelId] = useState<string | null>(null);
	const selected = AREAS.find((a) => a.id === selId) ?? null;
	// the modal keeps rendering the last destination through its fade-out
	const lastSelRef = useRef<Area | null>(null);
	if (selected) lastSelRef.current = selected;
	const shown = selected ?? lastSelRef.current;

	// live Bond score for the bottom bar; session completion drives the locks
	const [bond, setBond] = useState(loadBond);
	useEffect(() => subscribeBond(setBond), []);
	const [, setContextTick] = useState(0);
	useEffect(() => {
		const bump = () => setContextTick((t) => t + 1);
		window.addEventListener(CONTEXT_EVENT, bump);
		return () => window.removeEventListener(CONTEXT_EVENT, bump);
	}, []);
	useEffect(() => {
		if (open) {
			setBond(loadBond());
			setContextTick((t) => t + 1);
		}
	}, [open]);
	const isUnlocked = (a: Area) => a.id === "frostpeak" || isSessionDone(a.id);

	// the sidekick's chosen name, for the notification banner title
	const sidekickName = (() => {
		try {
			return JSON.parse(localStorage.getItem("sidekick_profile_v1") ?? "{}")?.name || "Sidekick";
		} catch {
			return "Sidekick";
		}
	})();
	// the top notification rides in with the locked-island modal
	const notifShown = !!selected && !isUnlocked(selected);

	// the cover-scaled map is wider than the screen; center the horizontal scroll
	// so both edge islands (Palm Cove / Sandy Dunes) are an easy swipe away
	const scrollRef = useRef<HTMLDivElement>(null);
	const centerScroll = () => {
		const el = scrollRef.current;
		if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
	};

	// the bottom promo card pops in only after the circle mask finishes expanding
	const [cardIn, setCardIn] = useState(false);
	useEffect(() => {
		if (!open) {
			setCardIn(false);
			setSelId(null); // never reopen onto a stale destination modal
			return;
		}
		requestAnimationFrame(centerScroll); // recenter in case the art was cached
		const t = window.setTimeout(() => setCardIn(true), CARD_DELAY);
		return () => window.clearTimeout(t);
	}, [open]);

	return (
		<div
			className={`absolute inset-0 z-40 overflow-hidden ${open ? "" : "pointer-events-none"}`}
			style={{
				background: MAP_BG,
				clipPath: open ? "circle(74% at 50% 50%)" : "circle(0% at 50% 50%)",
				transition: `clip-path ${REVEAL_MS}ms ${REVEAL_EASE}`,
			}}
		>
			{/* the 3:4 map fills the viewport height (cover); it's wider than the
			    screen, so it pans horizontally and opens centered. The gradient backs
			    it while the art loads. */}
			<div
				ref={scrollRef}
				className="no-scrollbar absolute inset-0 overflow-x-auto overflow-y-hidden"
				onClick={() => setSelId(null)}
			>
				<div className="relative h-full w-max">
					<img
						src={MAP_SRC}
						alt="World map"
						onLoad={centerScroll}
						className="block h-full w-auto max-w-none select-none"
						draggable={false}
					/>
					{AREAS.map((a) => {
						const unlocked = isUnlocked(a);
						const session = sessionFor(a.id);
						const startable = isSessionStartable(a.id);
						const isNextChallenge = nextSession()?.id === a.id;
						// low-map islands hang their card ABOVE the pin so nothing clips
						// at the bottom edge on tall (9:16) screens
						const cardAbove = parseFloat(a.top) > 60;
						return (
							<button
								key={a.id}
								onClick={(e) => {
									e.stopPropagation();
									// every island opens the modal: travel when unlocked,
									// the unlock-chat pitch when locked
									setSelId(a.id);
								}}
								aria-label={a.name}
								style={{ left: a.left, top: a.top }}
								className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 transition-transform duration-100 active:scale-95 ${
									cardAbove ? "flex-col-reverse" : "flex-col"
								}`}
							>
								{unlocked ? (
									<>
										<span
											className="relative grid h-9 w-9 place-items-center rounded-full text-[17px] shadow-[0_2px_7px_rgba(0,0,0,0.4)] ring-2 ring-white"
											style={{ background: a.color }}
										>
											{a.emoji}
										</span>
										<span className="whitespace-nowrap rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold text-neutral-800 shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
											{a.name}
										</span>
									</>
								) : session ? (
									// locked: the lock icon IS the marker (no emoji circle) —
									// "Chat to unlock" primary, the island name secondary
									<span className="relative">
										{isNextChallenge ? (
											<span className="absolute -inset-1.5 animate-ping rounded-2xl bg-[#7A5AF8]/45" />
										) : null}
										<span
											className={`relative flex items-center gap-2 rounded-2xl px-3 py-2 text-left ${
												startable
													? "bg-[#7A5AF8] text-white shadow-[0_3px_0_#5638c6]"
													: "bg-black/45 text-white shadow-[0_1px_4px_rgba(0,0,0,0.3)] backdrop-blur-sm"
											}`}
										>
											<LuLock className="h-4 w-4 shrink-0" strokeWidth={3} />
											<span className="leading-tight">
												<span className="block whitespace-nowrap text-[12px] font-extrabold">Chat to unlock</span>
												<span
													className={`block whitespace-nowrap text-[10px] font-semibold ${
														startable ? "text-white/75" : "text-white/60"
													}`}
												>
													{a.name}
												</span>
											</span>
										</span>
									</span>
								) : null}
							</button>
						);
					})}
				</div>
			</div>

			{/* top scrim + title + close, like a map app header */}
			<div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent pb-10 pt-[max(env(safe-area-inset-top),12px)]">
				<div className="pointer-events-auto flex items-center justify-end px-4">
					<button
						onClick={onClose}
						aria-label="Close map"
						className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-neutral-700 shadow backdrop-blur active:bg-white"
					>
						<LuX className="h-5 w-5" strokeWidth={2.5} />
					</button>
				</div>
			</div>

			{/* Default bottom card — the Bond progress bar. Hides when a marker's
			    place card takes over. Tapping it starts a chat (how the bond grows). */}
			<div
				className={`absolute inset-x-0 bottom-0 z-10 origin-bottom ${
					cardIn && !selected ? "" : "pointer-events-none"
				}`}
				style={{
					opacity: cardIn && !selected ? 1 : 0,
					transform: cardIn && !selected ? "scale(1)" : "scale(0.9)",
					transition: "transform 220ms cubic-bezier(0.34,1.56,0.64,1), opacity 140ms ease-out",
				}}
			>
				<button
					type="button"
					onClick={onChat}
					className="mx-3 mb-[max(env(safe-area-inset-bottom),12px)] block w-[calc(100%-1.5rem)] rounded-[26px] bg-white/85 p-4 text-left shadow-[0_10px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform duration-100 active:scale-[0.98]"
				>
					<div className="flex items-center gap-2.5">
						<div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/10">
							<div
								className="h-full rounded-full bg-gradient-to-r from-[#ffb454] to-[#ff7a3d] transition-[width] duration-500 ease-out"
								style={{ width: `${(bond / BOND_MAX) * 100}%` }}
							/>
						</div>
						<span className="text-[14px] font-extrabold tabular-nums text-[#111]">{bond}%</span>
					</div>
					<div className="mt-2 text-center text-[14px] font-semibold text-[#111]/60">
						Grow our bond to explore the world
					</div>
				</button>
			</div>

			{/* Destination modal — centered, minimal: name, blurb, bond progress
			    toward the unlock (when locked), one pill CTA. Backdrop tap dismisses. */}
			<div
				className={`absolute inset-0 z-20 grid place-items-center transition-all duration-200 ease-out ${
					selected ? "opacity-100" : "pointer-events-none opacity-0"
				}`}
			>
				<button
					type="button"
					aria-label="Dismiss"
					onClick={() => setSelId(null)}
					className="absolute inset-0 bg-black/30"
				/>
				<div
					className={`relative mx-8 w-[calc(100%-4rem)] max-w-sm rounded-[28px] bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out ${
						selected ? "scale-100" : "scale-90"
					}`}
				>
					{shown ? (
						!isUnlocked(shown) ? (
							(() => {
								const session = sessionFor(shown.id);
								const startable = isSessionStartable(shown.id);
								const target = startable ? session : nextSession();
								if (!session || !target) return null;
								return (
									<>
										{/* bond score, up top */}
										<div className="mb-1.5 flex items-center gap-1.5">
											<img src="/icons/bond.png" alt="" draggable={false} className="h-5 w-5 object-contain" />
											<span className="font-mono text-[12px] font-bold lowercase tracking-tight text-neutral-500">
												bond score
											</span>
											<span className="ml-auto font-mono text-[13px] font-bold tabular-nums text-neutral-800">{bond}%</span>
										</div>
										<div className="h-2.5 w-full overflow-hidden rounded-full bg-black/10">
											<div
												className="h-full rounded-full bg-gradient-to-r from-[#ffb454] to-[#ff7a3d] transition-[width] duration-500 ease-out"
												style={{ width: `${(bond / BOND_MAX) * 100}%` }}
											/>
										</div>

										{/* primary CTA copy (the "get to know you" line is the top
										    notification that drops in with this modal) */}
										<div className="mt-7 text-center text-[19px] font-extrabold leading-snug text-neutral-900">
											Start a Guided Chat to Unlock
										</div>

										<button
											onClick={() => onStartSession?.(target.id)}
											className="mt-4 flex w-full items-center justify-center rounded-full bg-[#7A5AF8] py-3.5 text-[16px] font-bold text-white shadow-[0_4px_0_#5638c6] transition-all duration-100 active:translate-y-[3px] active:shadow-[0_1px_0_#5638c6]"
										>
											Chat
										</button>
									</>
								);
							})()
						) : isUnlocked(shown) ? (
							// travel confirmation: just the big question + a chunky purple
							// pill with a hard (0-blur) drop shadow it presses down into
							<>
								<div className="px-2 py-8 text-center text-[26px] font-extrabold leading-tight text-neutral-900">
									Travel to {shown.name}?
								</div>
								<button
									onClick={() => onTravel?.(shown.biome)}
									className="flex w-full items-center justify-center rounded-full bg-[#7A5AF8] py-4 text-[17px] font-bold text-white shadow-[0_5px_0_#5638c6] transition-all duration-100 active:translate-y-[4px] active:shadow-[0_1px_0_#5638c6]"
								>
									Continue
								</button>
							</>
						) : (
							null
						)
					) : null}
				</div>
			</div>

			{/* Notification banner — drops in from the top in sync with the locked
			    island modal, like a push from the sidekick. */}
			<div
				className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3 pt-[max(env(safe-area-inset-top),12px)] transition-transform duration-[350ms] ${
					notifShown ? "translate-y-0" : "-translate-y-[140%]"
				}`}
				style={{ transitionTimingFunction: "cubic-bezier(0.34,1.4,0.64,1)" }}
			>
				<div className="flex w-full max-w-sm items-center gap-3 rounded-[22px] bg-white/90 px-3.5 py-3 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl">
					<SidekickAvatar className="h-10 w-10 shrink-0 object-contain" alt="" />
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-extrabold text-neutral-900">{sidekickName}</div>
						<div className="text-[13px] font-medium leading-snug text-neutral-600">
							I need to get to know you better before we can travel that far
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
