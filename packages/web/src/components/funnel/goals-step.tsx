import { useState } from "react";
import { LuCheck } from "react-icons/lu";
import { BTN_PRIMARY, PASTELS } from "./constants";
import type { GoalsConfig } from "./types";

export function GoalsStep({
	config,
	initial,
	onSubmit,
}: {
	config: GoalsConfig;
	initial?: string[];
	onSubmit: (values: string[]) => void;
}) {
	const [selected, setSelected] = useState<string[]>(initial ?? []);

	const toggle = (value: string) =>
		setSelected((prev) =>
			prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
		);

	const canContinue = selected.length >= config.minSelections;

	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 overflow-y-auto px-6 pt-5 pb-4">
				<h2 className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-[#111]">
					{config.title}
				</h2>
				{config.subtitle ? (
					<p className="mt-1.5 mb-6 text-[15px] leading-relaxed text-[#111]/55">{config.subtitle}</p>
				) : (
					<div className="mb-6" />
				)}

				<div className="flex flex-col gap-2.5">
					{config.options.map((opt, i) => {
						const on = selected.includes(opt.value);
						return (
							<button
								key={opt.value}
								onClick={() => toggle(opt.value)}
								style={{ backgroundColor: PASTELS[i % PASTELS.length] }}
								className="w-full flex items-center gap-4 rounded-2xl pl-3 pr-5 py-2.5 text-left transition active:scale-[0.99]"
							>
								{opt.icon ? (
									<img
										src={opt.icon}
										alt=""
										className="w-14 h-14 object-contain shrink-0 select-none mix-blend-multiply"
										draggable={false}
									/>
								) : opt.emoji ? (
									<span className="text-3xl leading-none w-14 text-center shrink-0">{opt.emoji}</span>
								) : null}
								<span className="flex-1 text-[17px] font-bold leading-tight text-[#111]">
									{opt.label}
								</span>
								{on ? (
									<span className="w-6 h-6 rounded-full bg-[#111] flex items-center justify-center shrink-0">
										<LuCheck className="w-3.5 h-3.5 text-white" strokeWidth={3.5} />
									</span>
								) : null}
							</button>
						);
					})}
				</div>
			</div>

			<div className="px-6 pt-3 pb-8">
				<button onClick={() => onSubmit(selected)} disabled={!canContinue} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		</div>
	);
}
