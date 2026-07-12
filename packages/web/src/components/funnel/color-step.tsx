import { useState } from "react";
import { BTN_PRIMARY } from "./constants";
import { SIDEKICK_COLORS, colorById, loadProfile, saveProfile } from "./sidekick-colors";

// Onboarding: choose the sidekick's color (stored as a property).
export function ColorStep({ onContinue }: { onContinue: () => void }) {
	const [colorId, setColorId] = useState(loadProfile().color);
	const color = colorById(colorId);

	const submit = () => {
		saveProfile({ color: colorId });
		onContinue();
	};

	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 overflow-y-auto px-6 pt-6 flex flex-col items-center text-center">
				<h2 className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-[#111]">
					Choose your Sidekick's color
				</h2>

				<div className="mt-3 h-56 flex items-center justify-center">
					<img
						key={colorId}
						src={color.asset}
						alt={`${color.label} sidekick`}
						className="max-h-full w-auto object-contain select-none animate-scale-in"
						draggable={false}
					/>
				</div>

				<div className="mt-5 flex flex-wrap justify-center gap-3.5 max-w-[300px]">
					{SIDEKICK_COLORS.map((c) => {
						const on = c.id === colorId;
						return (
							<button
								key={c.id}
								onClick={() => setColorId(c.id)}
								aria-label={c.label}
								aria-pressed={on}
								className={`w-12 h-12 rounded-full transition ${
									on ? "ring-2 ring-offset-2 ring-[#111]" : "ring-1 ring-[#111]/15"
								}`}
								style={{ backgroundColor: c.hex }}
							/>
						);
					})}
				</div>

				<p className="mt-6 max-w-xs text-[12px] leading-relaxed text-[#111]/40">
					Heads up: these illustrations are AI-generated, so a sidekick's pose can shift slightly
					between colors. We're refining this.
				</p>
			</div>

			<div className="px-6 pt-3 pb-8">
				<button onClick={submit} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		</div>
	);
}
