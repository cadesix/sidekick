import { useEffect, useRef, useState } from "react";
import { LuX, LuLock } from "react-icons/lu";

// A single static map for the world page. The map art is 3:4 — shorter than a
// phone screen — so it fills the height (cover) over a sky→sea gradient that backs
// the letterbox bands while the art loads.
const MAP_SRC = "/world-map-day.webp";
const MAP_BG = "linear-gradient(#9d8fc2, #6991ac)";

// Circle-mask reveal. The radius eases out (fast → settle) so the *area* revealed
// (∝ r²) doesn't accelerate as it grows. Target 74% ≈ just enough to reach the
// corners (corner distance is ~70.7% of the clip reference), so the deceleration
// lands ON-screen instead of overshooting off-frame. The promo card pops after.
const REVEAL_MS = 380;
const REVEAL_EASE = "cubic-bezier(0.33, 1, 0.68, 1)"; // easeOutCubic — graceful settle, deceleration stays on-screen
const CARD_DELAY = 300; // circle has visually landed by here; then the card pops

// Full-screen "world map" that the dock's Map icon opens. Shows the stylized
// island world with Apple/Google-Maps-style markers over each biome. Each area is
// an unlockable region — unlocked ones get a bright pin, locked ones a muted pin
// with a lock. Tapping a marker slides up an Apple-Maps-style place card.

type Area = {
	id: string;
	name: string;
	emoji: string;
	color: string; // marker badge background
	left: string; // % position over the map image
	top: string;
	unlocked: boolean;
	blurb: string;
};

// positions are % of the world-map-*.webp images (all normalized to 1080×1440)
const AREAS: Area[] = [
	{ id: "frostpeak", name: "Frostpeak", emoji: "❄️", color: "#cfe6ff", left: "28%", top: "26%", unlocked: true, blurb: "Snow-capped summit" },
	{ id: "pinewood", name: "Pinewood", emoji: "🌲", color: "#8fd18f", left: "74%", top: "32%", unlocked: true, blurb: "Evergreen forest" },
	{ id: "blossom", name: "Blossom Vale", emoji: "🌸", color: "#ffc1dd", left: "29%", top: "55%", unlocked: false, blurb: "Cherry-blossom groves" },
	{ id: "dunes", name: "Sandy Dunes", emoji: "🏜️", color: "#f2c98a", left: "80%", top: "64%", unlocked: false, blurb: "Golden desert canyon" },
	{ id: "palmcove", name: "Palm Cove", emoji: "🌴", color: "#7fd6b0", left: "18%", top: "79%", unlocked: false, blurb: "Tropical palm shore" },
	{ id: "ember", name: "Mount Ember", emoji: "🌋", color: "#ff8a5b", left: "58%", top: "86%", unlocked: false, blurb: "Smouldering volcano" },
];

export function WorldMap({ open, onClose, onChat }: { open: boolean; onClose: () => void; onChat?: () => void }) {
	const [selId, setSelId] = useState<string | null>(null);
	const selected = AREAS.find((a) => a.id === selId) ?? null;

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
									a.unlocked ? "" : "opacity-80 grayscale"
								}`}
								style={{ background: a.color }}
							>
								{a.emoji}
								{!a.unlocked ? (
									<span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-neutral-800 ring-[1.5px] ring-white">
										<LuLock className="h-2.5 w-2.5 text-white" strokeWidth={3} />
									</span>
								) : null}
							</span>
							<span
								className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.3)] ${
									a.unlocked ? "bg-white/95 text-neutral-800" : "bg-black/50 text-white/80 backdrop-blur-sm"
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

			{/* Default bottom prompt — styled like an incoming chat message from the
			    sidekick (avatar + cream bubble, matching the onboarding chat). Hides
			    when a marker's place card takes over. Tapping it starts a chat (how
			    you unlock areas). */}
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
					className="mx-3 mb-[max(env(safe-area-inset-bottom),12px)] flex w-[calc(100%-1.5rem)] items-end gap-2.5 rounded-[26px] bg-white/70 p-3 text-left shadow-[0_10px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform duration-100 active:scale-[0.98]"
				>
					<img
						src="/sidekick-pfp.webp"
						alt="Sidekick"
						draggable={false}
						className="pointer-events-none h-11 w-11 shrink-0 select-none object-contain"
					/>
					<div className="rounded-3xl rounded-bl-md bg-[#FBEFC9] px-4 py-3">
						<div className="text-[17px] font-extrabold leading-tight text-[#111]">Explore the World</div>
						<div className="mt-0.5 text-[14px] leading-snug text-[#111]/60">Unlock new areas by chatting with me</div>
					</div>
				</button>
			</div>

			{/* Apple-Maps-style place card */}
			<div
				className={`absolute inset-x-0 bottom-0 z-20 transition-transform duration-300 ease-out ${
					selected ? "translate-y-0" : "pointer-events-none translate-y-full"
				}`}
			>
				{selected ? (
					<div className="mx-3 mb-[max(env(safe-area-inset-bottom),12px)] rounded-[26px] bg-white p-4 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
						<div className="flex items-center gap-3">
							<span
								className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl ring-1 ring-black/5"
								style={{ background: selected.color }}
							>
								{selected.emoji}
							</span>
							<div className="min-w-0">
								<div className="truncate text-[17px] font-bold text-neutral-900">{selected.name}</div>
								<div className="truncate text-sm text-neutral-500">
									{selected.blurb} · {selected.unlocked ? "Unlocked" : "Locked"}
								</div>
							</div>
							<button
								onClick={() => setSelId(null)}
								aria-label="Dismiss"
								className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-200 text-neutral-500 active:bg-neutral-300"
							>
								<LuX className="h-4 w-4" strokeWidth={2.5} />
							</button>
						</div>
						<button
							disabled={!selected.unlocked}
							className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-semibold transition ${
								selected.unlocked
									? "bg-[#0a84ff] text-white active:bg-[#0a74e0]"
									: "bg-neutral-100 text-neutral-400"
							}`}
						>
							{selected.unlocked ? (
								"Explore"
							) : (
								<>
									<LuLock className="h-4 w-4" strokeWidth={2.5} /> Locked
								</>
							)}
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}
