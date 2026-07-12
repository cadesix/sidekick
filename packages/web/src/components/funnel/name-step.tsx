import { useState } from "react";
import { BTN_PRIMARY } from "./constants";

// Onboarding name capture — a single text field + Continue.
export function NameStep({
	config,
	initial,
	onSubmit,
}: {
	config: { title: string; subtitle?: string; placeholder?: string };
	initial?: string;
	onSubmit: (value: string) => void;
}) {
	const [value, setValue] = useState(initial ?? "");
	const canContinue = value.trim().length > 0;

	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 overflow-y-auto px-6 pt-6">
				<h2 className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-[#111]">
					{config.title}
				</h2>
				{config.subtitle ? (
					<p className="mt-1.5 text-[15px] leading-relaxed text-[#111]/55">{config.subtitle}</p>
				) : null}
				<input
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && canContinue) onSubmit(value.trim());
					}}
					placeholder={config.placeholder ?? "Type here"}
					autoFocus
					className="mt-6 w-full px-5 py-4 rounded-2xl bg-[#F3F3F5] text-[17px] font-medium text-[#111] placeholder:text-[#111]/35 focus:outline-none focus:ring-2 focus:ring-[#111]/15"
				/>
			</div>

			<div className="px-6 pt-3 pb-8">
				<button onClick={() => onSubmit(value.trim())} disabled={!canContinue} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		</div>
	);
}
