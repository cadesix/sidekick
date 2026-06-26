import { useState } from "react";
import { LuCheck } from "react-icons/lu";
import { StepHeader } from "./step-header";
import type { MultiSelectQuestion } from "./types";

export function MultiSelectStep({
	question,
	initial,
	onAnswer,
}: {
	question: MultiSelectQuestion;
	initial: string[];
	onAnswer: (values: string[]) => void;
}) {
	const [selected, setSelected] = useState<string[]>(initial);

	const toggle = (value: string) => {
		setSelected((prev) =>
			prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
		);
	};

	const canContinue = selected.length >= question.minSelections;

	return (
		<div className="flex flex-col max-h-full">
			<StepHeader title={question.title} subtitle={question.subtitle} />

			<div className="overflow-y-auto min-h-0 px-6 pb-3">
				<div className="grid grid-cols-2 gap-2">
					{question.options.map((option) => {
						const isSelected = selected.includes(option.value);
						return (
							<button
								key={option.value}
								onClick={() => toggle(option.value)}
								className={`relative flex items-center gap-2.5 text-left px-3.5 py-3.5 rounded-2xl border transition-all duration-150 active:scale-[0.98] ${
									isSelected
										? "border-amber-400 bg-amber-50 ring-1 ring-amber-300"
										: "border-stone-200 bg-stone-50 hover:bg-stone-100"
								}`}
							>
								{option.emoji ? (
									<span className="text-xl shrink-0 leading-none">{option.emoji}</span>
								) : null}
								<span className="flex-1 text-[14px] font-medium leading-snug text-stone-900">
									{option.label}
								</span>
								{isSelected ? (
									<span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
										<LuCheck className="w-2.5 h-2.5 text-white" strokeWidth={3} />
									</span>
								) : null}
							</button>
						);
					})}
				</div>
			</div>

			<div className="sticky bottom-0 bg-white rounded-b-[28px] px-6 pb-7 pt-3">
				<button
					onClick={() => onAnswer(selected)}
					disabled={!canContinue}
					className="w-full py-4 bg-stone-900 hover:bg-stone-800 active:bg-stone-700 text-white text-base font-medium rounded-2xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				>
					{canContinue ? "Continue" : "Select at least one"}
				</button>
			</div>
		</div>
	);
}
