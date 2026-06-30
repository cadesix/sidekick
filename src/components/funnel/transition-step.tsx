import { useEffect, useState } from "react";
import { BTN_PRIMARY } from "./constants";

type GoalChip = { label: string; icon?: string };

// Two-series line chart on a subtle blue grid: "with a sidekick" sweeps up in an
// S-curve (green, happy face as the endpoint dot) vs "on your own" (flat grey).
function SidekickChart() {
	const [on, setOn] = useState(false);
	useEffect(() => {
		const t = setTimeout(() => setOn(true), 80);
		return () => clearTimeout(t);
	}, []);

	return (
		<svg viewBox="0 0 320 188" className="w-full" role="img" aria-label="Goal completion over time">
			<defs>
				<pattern id="sk-grid" width="26.5" height="26.5" patternUnits="userSpaceOnUse">
					<path d="M26.5 0H0V26.5" fill="none" stroke="#CFE4F4" strokeWidth="1" />
				</pattern>
			</defs>
			<rect x="0" y="0" width="320" height="188" fill="url(#sk-grid)" />

			{/* On your own — gentle, nearly flat */}
			<path
				d="M22,158 C 110,156 200,150 298,140"
				fill="none"
				stroke="#B9C0CC"
				strokeWidth="4"
				strokeLinecap="round"
				pathLength={1}
				strokeDasharray={1}
				strokeDashoffset={on ? 0 : 1}
				style={{ transition: "stroke-dashoffset 1.1s ease-out" }}
			/>

			{/* With a sidekick — S-curve: flat start, steep middle, eases at the top */}
			<path
				d="M22,160 C 80,160 120,154 158,120 C 196,86 232,54 296,48"
				fill="none"
				stroke="#5FB763"
				strokeWidth="5"
				strokeLinecap="round"
				pathLength={1}
				strokeDasharray={1}
				strokeDashoffset={on ? 0 : 1}
				style={{ transition: "stroke-dashoffset 1.3s ease-out" }}
			/>

			{/* Happy face as the endpoint indicator of the sidekick line */}
			<image
				href="/faces/5.webp"
				x="273"
				y="25"
				width="46"
				height="46"
				style={{
					transformBox: "fill-box",
					transformOrigin: "center",
					opacity: on ? 1 : 0,
					transform: on ? "rotate(7deg) scale(1)" : "rotate(7deg) scale(0.2)",
					transition:
						"opacity .35s ease-out 1.05s, transform .5s cubic-bezier(.34,1.56,.64,1) 1.05s",
				}}
			/>
		</svg>
	);
}

export function TransitionStep({
	goals,
	onContinue,
}: {
	goals: GoalChip[];
	onContinue: () => void;
}) {
	return (
		<div className="h-full flex flex-col px-6 pt-4 pb-8">
			<div className="flex-1 flex flex-col justify-center">
				{goals.length > 0 ? (
					<div className="mb-6">
						<p className="text-center text-[11px] font-bold uppercase tracking-wider text-[#111]/40 mb-2.5">
							Your goals
						</p>
						<div className="flex flex-wrap gap-2 justify-center">
							{goals.map((g) => (
								<span
									key={g.label}
									className="flex items-center gap-1.5 rounded-full bg-[#F3F3F5] pl-1.5 pr-3 py-1"
								>
									{g.icon ? (
										<img
											src={g.icon}
											alt=""
											className="w-5 h-5 object-contain select-none mix-blend-multiply"
											draggable={false}
										/>
									) : null}
									<span className="text-[13px] font-semibold text-[#111]">{g.label}</span>
								</span>
							))}
						</div>
					</div>
				) : null}

				<h2 className="text-center text-[24px] font-extrabold leading-tight tracking-[-0.01em] text-[#111]">
					With a sidekick, you're <span className="text-[#56AE50]">87%</span> more likely to achieve
					your goals.
				</h2>

				<div className="mt-6 rounded-3xl bg-[#E9F3FC] p-4">
					<SidekickChart />
				</div>

				<div className="mt-3 flex items-center justify-center gap-5 text-[12px] font-semibold">
					<span className="flex items-center gap-1.5">
						<span className="w-3.5 h-1.5 rounded-full bg-[#5FB763]" />
						<span className="text-[#111]">With a sidekick</span>
					</span>
					<span className="flex items-center gap-1.5">
						<span className="w-3.5 h-1.5 rounded-full bg-[#B9C0CC]" />
						<span className="text-[#111]/45">On your own</span>
					</span>
				</div>
			</div>

			<button onClick={onContinue} className={BTN_PRIMARY}>
				Continue
			</button>
		</div>
	);
}
