import { StepHeader } from "./step-header";
import type { QuizQuestion } from "./types";

export function QuizStep({
	question,
	onAnswer,
}: {
	question: QuizQuestion;
	onAnswer: (value: string) => void;
}) {
	return (
		<div className="flex flex-col max-h-full">
			<StepHeader title={question.title} subtitle={question.subtitle} />

			<div className="overflow-y-auto min-h-0 px-6 pb-7">
				<div className="space-y-2">
					{question.options.map((option) => (
						<button
							key={option.value}
							onClick={() => onAnswer(option.value)}
							className="w-full flex items-center gap-3 text-left px-4 py-3.5 rounded-2xl bg-stone-50 hover:bg-stone-100 active:scale-[0.98] transition-all duration-150"
						>
							{option.emoji ? (
								<span className="text-2xl shrink-0 leading-none">{option.emoji}</span>
							) : null}
							<span className="flex-1 min-w-0">
								<span className="block text-[15px] font-medium leading-snug text-stone-900">
									{option.label}
								</span>
								{option.description ? (
									<span className="block text-[14px] text-stone-500 mt-0.5">
										{option.description}
									</span>
								) : null}
							</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
