import { LuFlame } from "react-icons/lu";
import { Coin } from "./shop-sheet";
import { MILESTONES } from "./sidekick-daily-box";

// Streak modal: current streak up top, then only the NEXT few milestone
// containers — everything past that is a mystery card, so upcoming rewards
// tease without revealing the whole curve. The schedule itself is frontloaded
// (a reward every day for week one) then tapers (10, 14, 21, 30…365) so later
// rewards keep scarcity. Rewards are coins or real shop cosmetics (product
// renders), granted through the daily box on milestone days
// (sidekick-daily-box.ts, which owns the MILESTONES table).

const SHOW_NEXT = 3; // upcoming milestones revealed; the rest stay hidden

export function StreakModal({ open, onClose, streak }: { open: boolean; onClose: () => void; streak: number }) {
	const upcoming = MILESTONES.filter((m) => m.day > streak);
	const revealed = upcoming.slice(0, SHOW_NEXT);
	// the tease: the very next milestone after the revealed ones
	const mystery = upcoming[SHOW_NEXT];

	return (
		<div
			className={`absolute inset-0 z-40 grid place-items-center transition-all duration-200 ease-out ${
				open ? "opacity-100" : "pointer-events-none opacity-0"
			}`}
		>
			<button type="button" aria-label="Dismiss" onClick={onClose} className="absolute inset-0 bg-black/30" />
			<div
				className={`relative mx-8 w-[calc(100%-4rem)] max-w-sm rounded-[28px] bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out ${
					open ? "scale-100" : "scale-90"
				}`}
			>
				{/* the streak itself */}
				<div className="flex flex-col items-center text-center">
					<span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fff1e6]">
						<LuFlame className="h-8 w-8 text-[#ff7a3d]" strokeWidth={2.5} />
					</span>
					<div className="mt-2 text-[24px] font-extrabold leading-tight text-neutral-900">
						{streak}-day streak
					</div>
					<div className="text-[13px] font-medium text-neutral-400">Come back daily to earn rewards</div>
				</div>

				{/* next few milestones, then mystery */}
				<div className="mt-5 space-y-2.5">
					{revealed.map((m, i) => (
						<div
							key={m.day}
							className={`flex items-center gap-3 rounded-[18px] px-3.5 py-2.5 shadow-[0_3px_0_rgba(0,0,0,0.08)] ${
								i === 0 ? "bg-white ring-2 ring-[#ff7a3d]" : "bg-neutral-100"
							}`}
						>
							<span className="grid h-11 w-11 shrink-0 place-items-center">
								{m.render ? (
									<img
										src={`/shop-renders/${m.render}.png`}
										alt=""
										loading="lazy"
										draggable={false}
										className="h-11 w-11 object-contain"
									/>
								) : (
									<Coin className="h-8 w-8" />
								)}
							</span>
							<div className="min-w-0 flex-1">
								<div className="text-[12px] font-bold uppercase tracking-wide text-neutral-400">Day {m.day}</div>
								<div className="truncate text-[15px] font-bold text-neutral-900">{m.label}</div>
							</div>
							<span
								className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
									i === 0 ? "bg-[#fff1e6] text-[#ff7a3d]" : "bg-white text-neutral-400"
								}`}
							>
								{m.day - streak === 1 ? "Tomorrow" : `In ${m.day - streak} days`}
							</span>
						</div>
					))}
					{mystery ? (
						<div className="flex items-center gap-3 rounded-[18px] bg-neutral-100 px-3.5 py-2.5 opacity-80 shadow-[0_3px_0_rgba(0,0,0,0.08)]">
							<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-[20px] font-extrabold text-neutral-300">
								?
							</span>
							<div className="min-w-0 flex-1">
								<div className="text-[12px] font-bold uppercase tracking-wide text-neutral-400">Day {mystery.day}</div>
								<div className="truncate text-[15px] font-bold text-neutral-500">Come back tomorrow for more!</div>
							</div>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
