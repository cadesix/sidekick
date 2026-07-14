import { forwardRef, useEffect, useRef, useState } from "react";
import { LuFlame } from "react-icons/lu";
import { Coin } from "./shop-sheet";
import type { BoxReward, BoxTier } from "./sidekick-daily-box";

// The daily box UI (docs/token-economy.md#faucets): the first session of the
// day runs streak splash → box on the ground → tap → burst → rewards modal.
// The host (home5) orchestrates the stages; this file owns the three visuals.

// Tier looks. The chest is drawn in the world's cel language: flat two-tone
// fills with the same warm amber "ink" outline the character's inverted-hull
// silhouette uses (sidekick-settings outlineColor #b77d1a).
const INK = "#b77d1a";
const TIER_STYLE: Record<BoxTier, { body: string; shade: string; strap: string; emblem: string }> = {
	base: { body: "#FFD65C", shade: "#EDB93A", strap: "#FF5B4D", emblem: "#FFF2DC" },
	silver: { body: "#DCE6F5", shade: "#B9C9E2", strap: "#7C5CFF", emblem: "#FFFFFF" },
	gold: { body: "#FFC93D", shade: "#F0A21C", strap: "#7C5CFF", emblem: "#FFF6D8" },
};

const CONFETTI_COLORS = ["#FF5B4D", "#F2C94C", "#7C5CFF", "#12C93E", "#9fd0ff", "#ffc1dd"];

// deterministic little scatter for confetti/rays (no Math.random in render)
function scatter(i: number, n: number, dist: number): { x: number; y: number } {
	const a = (i / n) * Math.PI * 2 + (i % 2 ? 0.4 : 0);
	const d = dist * (0.75 + 0.35 * ((i * 7919) % 10) * 0.1);
	return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85 - 30 };
}

// A chunky rounded loot chest, cel-shaded like the character: flat fills, one
// hard shade tone, thick amber ink outlines, star emblem on the latch.
function LootChestSvg({ tier, milestone }: { tier: BoxTier; milestone: boolean }) {
	const c = TIER_STYLE[tier];
	return (
		<svg viewBox="0 0 96 88" className="h-full w-full drop-shadow-[0_8px_10px_rgba(0,0,0,0.22)]">
			{/* soft contact shadow on the grass */}
			<ellipse cx="48" cy="82" rx="34" ry="5" fill="#000" opacity="0.15" />

			{/* domed lid */}
			<path d="M12 40 v-7 a24 24 0 0 1 24-24 h24 a24 24 0 0 1 24 24 v7 z" fill={c.body} />
			{/* lid cel-shade band (hard edge, no gradient) */}
			<path d="M12 40 v-6 h72 v6 z" fill={c.shade} />
			{/* body */}
			<rect x="12" y="40" width="72" height="38" rx="8" fill={c.body} />
			{/* body cel-shade: hard tone on the lower third */}
			<path d="M12 62 h72 v8 a8 8 0 0 1 -8 8 h-56 a8 8 0 0 1 -8 -8 z" fill={c.shade} />

			{/* strap over the top */}
			<path d="M41 9.5 h14 v68.5 h-14 z" fill={c.strap} />
			<path d="M41 62 h14 v16 h-14 z" fill="#000" opacity="0.14" />

			{/* ink outlines, drawn on top so fills stay flat */}
			<g fill="none" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round">
				<path d="M12 40 v-7 a24 24 0 0 1 24-24 h24 a24 24 0 0 1 24 24 v7" />
				<rect x="12" y="40" width="72" height="38" rx="8" />
				<path d="M12 40 h72" />
				<path d="M41 9.5 v69 M55 9.5 v69" />
			</g>

			{/* latch: a star emblem sitting on the seam */}
			<circle cx="48" cy="42" r="12.5" fill={c.emblem} stroke={INK} strokeWidth="3.5" />
			<path
				d="M48 34.5l2.4 4.9 5.4.8-3.9 3.8.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.9-3.8 5.4-.8z"
				fill={c.strap}
				stroke={INK}
				strokeWidth="1.8"
				strokeLinejoin="round"
			/>

			{/* flat highlight blob (vinyl-toy sheen, cel style) */}
			<path d="M22 22 a17 17 0 0 1 12-9 l3 0 a20 20 0 0 0 -12 9 z" fill="#fff" opacity="0.55" />

			{/* milestone days: a crown of sparkles so the box reads special */}
			{milestone ? (
				<g fill="#fff" stroke={INK} strokeWidth="1.6" strokeLinejoin="round">
					<path d="M48 -1l1.8 3.7 3.9.6-2.8 2.7.7 4-3.6-1.9-3.6 1.9.7-4-2.8-2.7 3.9-.6z" />
					<path d="M24 6l1.3 2.6 2.8.4-2 1.9.5 2.9-2.6-1.4-2.6 1.4.5-2.9-2-1.9 2.8-.4z" />
					<path d="M72 6l1.3 2.6 2.8.4-2 1.9.5 2.9-2.6-1.4-2.6 1.4.5-2.9-2-1.9 2.8-.4z" />
				</g>
			) : null}
		</svg>
	);
}

// The box sitting on the ground beside the character. The outer div is pinned
// by the canvas (groundRef → 3D→screen projection, bottom-center anchored,
// same pattern as the Bond badge). Tap → shake → burst, then onOpened fires.
export const GroundBox = forwardRef<
	HTMLDivElement,
	{ tier: BoxTier; milestone: boolean; hidden?: boolean; onOpened: () => void }
>(function GroundBox({ tier, milestone, hidden, onOpened }, ref) {
	const [stage, setStage] = useState<"drop" | "idle" | "burst">("drop");
	const timers = useRef<number[]>([]);
	useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

	const tap = () => {
		if (stage === "burst") return;
		setStage("burst");
		// shake (450ms) → pop/flash/confetti (~550ms) → hand off to the modal
		timers.current.push(window.setTimeout(onOpened, 1000));
	};

	return (
		<div
			ref={ref}
			className={`absolute left-0 top-0 z-10 transition-opacity duration-300 ${
				hidden ? "pointer-events-none opacity-0" : ""
			}`}
			style={{ visibility: "hidden" }}
		>
			<div className="relative h-[124px] w-[124px]">
				{/* sparkles teasing "tap me" */}
				{stage !== "burst" ? (
					<>
						<span className="absolute -left-4 top-2 animate-pulse text-[18px]">✨</span>
						<span className="absolute -right-3 top-12 animate-pulse text-[15px] [animation-delay:0.6s]">✨</span>
					</>
				) : null}

				{stage === "burst" ? (
					<>
						{/* flash ring */}
						<div className="animate-box-flash absolute inset-0 rounded-full bg-white" />
						{/* rays */}
						{Array.from({ length: 8 }, (_, i) => (
							<div
								key={`r${i}`}
								className="animate-box-ray absolute bottom-1/2 left-1/2 h-24 w-2 -translate-x-1/2 rounded-full"
								style={
									{
										"--ray-angle": `${i * 45}deg`,
										background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
										animationDelay: "0.42s",
									} as React.CSSProperties
								}
							/>
						))}
						{/* confetti chips */}
						{Array.from({ length: 14 }, (_, i) => {
							const { x, y } = scatter(i, 14, 118);
							return (
								<div
									key={`c${i}`}
									className="animate-box-confetti absolute left-1/2 top-1/2 h-3.5 w-3 rounded-[3px]"
									style={
										{
											"--cx": `${x.toFixed(0)}px`,
											"--cy": `${y.toFixed(0)}px`,
											background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
											animationDelay: "0.44s",
										} as React.CSSProperties
									}
								/>
							);
						})}
					</>
				) : null}

				{/* the box itself */}
				<button
					type="button"
					aria-label="Open daily box"
					onClick={tap}
					className={`absolute inset-0 ${
						stage === "drop" ? "animate-box-drop" : stage === "idle" ? "animate-box-bob" : ""
					}`}
					onAnimationEnd={() => stage === "drop" && setStage("idle")}
				>
					<span className={`block h-full w-full ${stage === "burst" ? "animate-box-shake" : ""}`}>
						<span className={`block h-full w-full ${stage === "burst" ? "animate-box-pop [animation-delay:0.45s]" : ""}`}>
							<LootChestSvg tier={tier} milestone={milestone} />
						</span>
					</span>
				</button>
			</div>
		</div>
	);
});

// Full-screen streak moment shown at the start of the first session of the
// day: the flame pops in and the count ticks up from yesterday's number.
export function StreakSplash({ streak, onDone }: { streak: number; onDone: () => void }) {
	const [shown, setShown] = useState(streak > 1 ? streak - 1 : streak);
	useEffect(() => {
		const tick = window.setTimeout(() => setShown(streak), 700); // the increment beat
		const done = window.setTimeout(onDone, 2100);
		return () => {
			window.clearTimeout(tick);
			window.clearTimeout(done);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<button
			type="button"
			onClick={onDone}
			aria-label="Continue"
			className="absolute inset-0 z-50 grid w-full place-items-center bg-black/35 backdrop-blur-[2px]"
		>
			<div className="animate-splash-pop flex flex-col items-center">
				<span className="grid h-24 w-24 place-items-center rounded-[28px] bg-white shadow-[0_16px_40px_rgba(0,0,0,0.3)]">
					<LuFlame className="h-14 w-14 text-[#ff7a3d]" strokeWidth={2.5} />
				</span>
				<div
					key={shown} // re-mount on tick so the number pops
					className="animate-splash-pop mt-4 text-[64px] font-extrabold leading-none text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)] tabular-nums"
				>
					{shown}
				</div>
				<div className="mt-1 text-[17px] font-bold text-white/90">day streak!</div>
			</div>
		</button>
	);
}

// count-up for the coin number in the rewards modal
function useCountUp(target: number, ms = 700): number {
	const [v, setV] = useState(0);
	useEffect(() => {
		let raf = 0;
		const t0 = performance.now();
		const step = (t: number) => {
			const k = Math.min(1, (t - t0) / ms);
			setV(Math.round(target * (1 - (1 - k) * (1 - k)))); // ease-out
			if (k < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [target, ms]);
	return v;
}

// What was inside: coins (counting up) and, on milestone days, the cosmetic.
export function BoxRewardsModal({ reward, onCollect }: { reward: BoxReward; onCollect: () => void }) {
	const coins = useCountUp(reward.coins * (reward.doubled ? 2 : 1));
	const item = reward.milestone?.render;

	return (
		<div className="absolute inset-0 z-50 grid place-items-center">
			<div className="absolute inset-0 bg-black/35" />
			<div className="animate-splash-pop relative mx-8 w-[calc(100%-4rem)] max-w-sm rounded-[28px] bg-white p-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
				<div className="text-[13px] font-bold uppercase tracking-widest text-neutral-400">Daily box</div>

				{/* coins */}
				<div className="mt-4 flex items-center justify-center gap-2.5">
					<Coin className="h-10 w-10" />
					<span className="text-[44px] font-extrabold leading-none text-neutral-900 tabular-nums">+{coins}</span>
				</div>
				{reward.doubled ? (
					<div className="mt-1.5 inline-block rounded-full bg-[#fff1e6] px-3 py-1 text-[12px] font-extrabold text-[#ff7a3d]">
						LUCKY BOX — 2× coins!
					</div>
				) : null}

				{/* milestone cosmetic */}
				{reward.milestone ? (
					<div className="mt-4 flex items-center gap-3 rounded-[18px] bg-neutral-100 px-3.5 py-2.5 text-left shadow-[0_3px_0_rgba(0,0,0,0.08)]">
						<span className="grid h-12 w-12 shrink-0 place-items-center">
							{item ? (
								<img src={`/shop-renders/${item}.png`} alt="" draggable={false} className="h-12 w-12 object-contain" />
							) : (
								<Coin className="h-9 w-9" />
							)}
						</span>
						<div className="min-w-0 flex-1">
							<div className="text-[12px] font-bold uppercase tracking-wide text-[#ff7a3d]">
								Day {reward.milestone.day} milestone
							</div>
							<div className="truncate text-[15px] font-bold text-neutral-900">{reward.milestone.label}</div>
						</div>
					</div>
				) : null}

				<button
					type="button"
					onClick={onCollect}
					className="mt-5 w-full rounded-full bg-[#F2C94C] py-3 text-[16px] font-extrabold text-white shadow-[0_4px_0_rgba(0,0,0,0.12)] transition-all duration-100 active:translate-y-[2px] active:shadow-[0_2px_0_rgba(0,0,0,0.12)]"
				>
					Collect
				</button>
			</div>
		</div>
	);
}
