import { useEffect, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
import { BOND_MAX, loadBond, subscribeBond } from "./sidekick-bond";
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
// Destinations unlock as your Bond score grows (guided sessions with the
// sidekick raise it — see sidekick-bond.ts); snow is free at Bond 0. Tapping a
// marker slides up an Apple-Maps-style place card; locked cards show the Bond
// needed and route into chat to start a session.

type Area = {
	id: string;
	name: string;
	emoji: string;
	color: string; // marker badge background
	left: string; // % position over the map image
	top: string;
	blurb: string;
	minBond: number; // Bond score needed to unlock
	quest: string; // suggested session topic, shown on the locked card
	biome: EnvironmentId; // the travel environment this destination renders
};

// positions are % of world-map-quests.webp (941×1672)
const AREAS: Area[] = [
	{ id: "frostpeak", name: "Frostpeak", emoji: "❄️", color: "#cfe6ff", left: "29%", top: "19%", blurb: "Snow-capped summit", minBond: 0, quest: "Say hi to your sidekick", biome: "snow" },
	{ id: "pinewood", name: "Pinewood", emoji: "🌲", color: "#8fd18f", left: "73%", top: "28%", blurb: "Evergreen forest", minBond: 25, quest: "Have your first check-in chat", biome: "forest" },
	{ id: "blossom", name: "Blossom Vale", emoji: "🌸", color: "#ffc1dd", left: "29%", top: "49%", blurb: "Cherry-blossom groves", minBond: 40, quest: "Share a goal you're working toward", biome: "blossom" },
	{ id: "dunes", name: "Sandy Dunes", emoji: "🏜️", color: "#f2c98a", left: "82%", top: "57%", blurb: "Golden desert canyon", minBond: 55, quest: "Talk through your morning routine", biome: "desert" },
	{ id: "palmcove", name: "Palm Cove", emoji: "🌴", color: "#7fd6b0", left: "24%", top: "73%", blurb: "Tropical palm shore", minBond: 70, quest: "Do a gratitude chat", biome: "tropical" },
	{ id: "ember", name: "Mount Ember", emoji: "🌋", color: "#ff8a5b", left: "65%", top: "79%", blurb: "Smouldering volcano", minBond: 85, quest: "Finish a tough-love pep talk", biome: "volcano" },
];

export function WorldMap({
	open,
	onClose,
	onChat,
	onTravel,
}: {
	open: boolean;
	onClose: () => void;
	onChat?: () => void;
	// travel to an unlocked destination — the host swaps the 3D environment and
	// closes the map (the closing reveal masks the instant world swap)
	onTravel?: (biome: EnvironmentId) => void;
}) {
	const [selId, setSelId] = useState<string | null>(null);
	const selected = AREAS.find((a) => a.id === selId) ?? null;
	// the modal keeps rendering the last destination through its fade-out
	const lastSelRef = useRef<Area | null>(null);
	if (selected) lastSelRef.current = selected;
	const shown = selected ?? lastSelRef.current;

	// live Bond score → which destinations are open (also re-read on open so
	// gains from sessions since the last visit show up)
	const [bond, setBond] = useState(loadBond);
	useEffect(() => subscribeBond(setBond), []);
	useEffect(() => {
		if (open) setBond(loadBond());
	}, [open]);
	const isUnlocked = (a: Area) => bond >= a.minBond;

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
					{AREAS.map((a) => (
						<button
							key={a.id}
							onClick={(e) => {
								e.stopPropagation();
								setSelId(a.id);
							}}
							aria-label={a.name}
							style={{ left: a.left, top: a.top }}
							className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-transform duration-100 active:scale-90"
						>
							<span
								className={`relative grid h-9 w-9 place-items-center rounded-full text-[17px] shadow-[0_2px_7px_rgba(0,0,0,0.4)] ring-2 ring-white ${
									isUnlocked(a) ? "" : "opacity-80 grayscale"
								}`}
								style={{ background: a.color }}
							>
								{a.emoji}
							</span>
							<span
								className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.3)] ${
									isUnlocked(a) ? "bg-white/95 text-neutral-800" : "bg-black/50 text-white/80 backdrop-blur-sm"
								}`}
							>
								{a.name}
							</span>
						</button>
					))}
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
						isUnlocked(shown) ? (
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
							<>
								<div className="text-center">
									<div className="text-[20px] font-extrabold text-neutral-900">{shown.name}</div>
									<div className="mt-0.5 text-[14px] text-neutral-500">{shown.blurb}</div>
								</div>
								<div className="mt-5">
									<div className="flex items-baseline justify-between text-[12px] font-semibold">
										<span className="text-neutral-400">Bond</span>
										<span className="tabular-nums text-neutral-500">
											{bond}% <span className="text-neutral-300">/ {shown.minBond}%</span>
										</span>
									</div>
									<div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-neutral-100">
										<div
											className="h-full rounded-full bg-gradient-to-r from-[#ffb454] to-[#ff7a3d] transition-[width] duration-500 ease-out"
											style={{ width: `${Math.min(100, (bond / shown.minBond) * 100)}%` }}
										/>
									</div>
									<div className="mt-2.5 text-center text-[13px] leading-snug text-neutral-400">
										{shown.quest}
									</div>
								</div>
								<button
									onClick={onChat}
									className="mt-5 flex w-full items-center justify-center rounded-full bg-[#111] py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.98] active:bg-[#333]"
								>
									Start a session
								</button>
							</>
						)
					) : null}
				</div>
			</div>
		</div>
	);
}
