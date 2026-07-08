import { useState } from "react";
import { BTN_PRIMARY } from "./constants";
import { colorById, loadProfile, saveProfile } from "./sidekick-colors";

// Onboarding: name the sidekick. Shows the color picked on the previous step.
export function NameSidekickStep({ onContinue }: { onContinue: () => void }) {
	const profile = loadProfile();
	const color = colorById(profile.color);
	const [name, setName] = useState(profile.name);
	const canContinue = name.trim().length > 0;

	const submit = () => {
		saveProfile({ name: name.trim() || "Sidekick" });
		onContinue();
	};

	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 overflow-y-auto px-6 pt-6 flex flex-col items-center text-center">
				<h2 className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-[#111]">
					Name your Sidekick
				</h2>

				<div className="mt-3 h-52 flex items-center justify-center">
					<img
						src={color.asset}
						alt=""
						aria-hidden="true"
						className="max-h-full w-auto object-contain select-none"
						draggable={false}
					/>
				</div>

				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && canContinue) submit();
					}}
					placeholder="Name your Sidekick"
					maxLength={20}
					autoFocus
					className="mt-2 w-full max-w-xs px-5 py-3.5 rounded-2xl bg-[#F3F3F5] text-center text-[17px] font-bold text-[#111] placeholder:font-medium placeholder:text-[#111]/35 focus:outline-none focus:ring-2 focus:ring-[#111]/15"
				/>
			</div>

			<div className="px-6 pt-3 pb-8">
				<button onClick={submit} disabled={!canContinue} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		</div>
	);
}
