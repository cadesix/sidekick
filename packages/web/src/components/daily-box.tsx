import { forwardRef, useEffect, useRef, useState } from "react";
import { LuFlame } from "react-icons/lu";
import { Coin } from "./shop-sheet";
import type { BoxReward } from "./sidekick-daily-box";

// The daily box UI (docs/token-economy.md#faucets): the first session of the
// day runs streak splash → chest on the ground → tap → burst → rewards modal.
// The chest itself is a real 3D prop in the scene (props/lootbox-v1.glb,
// built by tools/char-pipeline/scripts/build_lootbox.py and cel-shaded by the
// canvas). This file owns the DOM layer: the tap target + burst FX pinned
// over the chest, the streak splash, and the rewards modal. The burst FX
// timings mirror the canvas pop animation (wiggle 0–0.45s, swell 0.45–0.82s).

const CONFETTI_COLORS = ["#FF5B4D", "#F2C94C", "#7C5CFF", "#12C93E", "#9fd0ff", "#ffc1dd"];

// deterministic little scatter for confetti/rays (no Math.random in render)
function scatter(i: number, n: number, dist: number): { x: number; y: number } {
	const a = (i / n) * Math.PI * 2 + (i % 2 ? 0.4 : 0);
	const d = dist * (0.75 + 0.35 * ((i * 7919) % 10) * 0.1);
	return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85 - 30 };
}

// The DOM layer pinned over the 3D chest (groundRef → 3D→screen projection,
// bottom-center anchored, same pattern as the Bond badge): an invisible tap
// target, tease sparkles, and the burst FX. Tap fires onTap immediately (the
// host triggers the canvas pop animation), the FX play over the 3D swell, and
// onOpened fires when the chest is gone.
export const GroundBox = forwardRef<HTMLDivElement, { hidden?: boolean; onTap: () => void; onOpened: () => void }>(
	function GroundBox({ hidden, onTap, onOpened }, ref) {
		const [burst, setBurst] = useState(false);
		const timers = useRef<number[]>([]);
		useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

		const tap = () => {
			if (burst) return;
			setBurst(true);
			onTap(); // canvas starts rattle → lid swing → light
			// light pours out at ~0.62s; the rewards modal rides the beam
			timers.current.push(window.setTimeout(onOpened, 1200));
		};

		return (
			<div
				ref={ref}
				className={`absolute left-0 top-0 z-10 transition-opacity duration-300 ${
					hidden ? "pointer-events-none opacity-0" : ""
				}`}
				style={{ visibility: "hidden" }}
			>
				<div className="relative h-[150px] w-[150px]">
					{/* badge floating above the chest */}
					{!burst ? (
						<div className="absolute -top-4 left-1/2 -translate-x-1/2 animate-bounce whitespace-nowrap rounded-full bg-white/90 px-3.5 py-1.5 text-[14px] font-extrabold text-[#111] shadow-[0_3px_0_rgba(0,0,0,0.12)] backdrop-blur-sm">
							Daily Chest!
						</div>
					) : null}
					{/* sparkles teasing "tap me" */}
					{!burst ? (
						<>
							<span className="absolute left-1 top-9 animate-pulse text-[18px]">✨</span>
							<span className="absolute right-2 top-16 animate-pulse text-[15px] [animation-delay:0.6s]">✨</span>
						</>
					) : null}

					{burst ? (
						<>
							{/* soft flash, timed to the moment the light bursts out */}
							<div
								className="animate-box-flash absolute inset-6 rounded-full [animation-delay:0.62s]"
								style={{
									background:
										"radial-gradient(closest-side, rgba(255,255,255,0.95), rgba(255,252,235,0.55) 55%, rgba(255,252,235,0))",
								}}
							/>
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
												animationDelay: "0.7s",
											} as React.CSSProperties
										}
									/>
								);
							})}
						</>
					) : null}

					{/* invisible tap target covering the chest */}
					<button type="button" aria-label="Open daily box" onClick={tap} className="absolute inset-0 rounded-full" />
				</div>
			</div>
		);
	},
);

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
