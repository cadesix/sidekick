import { StepHeader } from "./step-header";
import { resolvePersona } from "./persona";
import type { AgreementConfig, FunnelAnswers } from "./types";

const OPTIONS = [
	{ value: "agree", label: "That's me", emoji: "👍" },
	{ value: "somewhat", label: "Kind of", emoji: "🤔" },
	{ value: "disagree", label: "Not really", emoji: "🙅" },
];

export function AgreementStep({
	config,
	answers,
	onAnswer,
}: {
	config: AgreementConfig;
	answers: FunnelAnswers;
	onAnswer: (value: string) => void;
}) {
	const persona = resolvePersona(answers.persona);
	const statement = config.statements[persona] ?? config.fallback;

	return (
		<div className="flex flex-col max-h-full">
			<StepHeader
				title={`“${statement}”`}
				subtitle={config.subtitle}
				titleClassName="text-[24px] font-serif italic font-medium tracking-[-0.01em]"
				subtitleClassName="text-stone-400"
			/>

			<div className="px-6 pb-7 space-y-2">
				{OPTIONS.map((option) => (
					<button
						key={option.value}
						onClick={() => onAnswer(option.value)}
						className="w-full flex items-center gap-3 text-left px-4 py-3.5 rounded-2xl bg-stone-50 hover:bg-stone-100 active:scale-[0.98] transition-all duration-150"
					>
						<span className="text-xl shrink-0 leading-none">{option.emoji}</span>
						<span className="text-[15px] font-medium leading-snug text-stone-900">
							{option.label}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
