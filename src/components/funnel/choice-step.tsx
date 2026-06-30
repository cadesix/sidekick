import type { ChoiceOption } from "./types";

// Single-select onboarding question (age groups, gender, …). Tapping an option
// records it and advances immediately.
export function ChoiceStep({
	config,
	selected,
	onSelect,
}: {
	config: { title: string; subtitle?: string; options: ChoiceOption[] };
	selected?: string;
	onSelect: (value: string) => void;
}) {
	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 overflow-y-auto px-6 pt-6 pb-4">
				<h2 className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-[#111]">
					{config.title}
				</h2>
				{config.subtitle ? (
					<p className="mt-1.5 text-[15px] leading-relaxed text-[#111]/55">{config.subtitle}</p>
				) : null}

				<div className="mt-6 flex flex-col gap-2.5">
					{config.options.map((opt) => {
						const on = selected === opt.value;
						return (
							<button
								key={opt.value}
								onClick={() => onSelect(opt.value)}
								className={`w-full text-left px-5 py-4 rounded-2xl text-[17px] font-bold transition active:scale-[0.99] ${
									on ? "bg-[#111] text-white" : "bg-[#F3F3F5] text-[#111]"
								}`}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
