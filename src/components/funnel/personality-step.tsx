import type { PersonalityItem } from "./types";

// The Likert scale as a column of full-width buttons — each with an expressive face
// (red/sad → green/happy) and a subtle background tint aligned to that face's color.
type ScaleOption = { value: string; label: string; face: string; bg: string; bgOn: string; shadow: string };

const SCALE: ScaleOption[] = [
	{ value: "1", label: "Strongly Disagree", face: "/faces/1.webp", bg: "#F8E7E6", bgOn: "#F2A8A6", shadow: "#F2A8A6" },
	{ value: "2", label: "Disagree", face: "/faces/2.webp", bg: "#F9EBE1", bgOn: "#F2AB7E", shadow: "#F2AB7E" },
	{ value: "3", label: "Neutral", face: "/faces/3.webp", bg: "#FAF3DA", bgOn: "#EBD280", shadow: "#EBD280" },
	{ value: "4", label: "Agree", face: "/faces/4.webp", bg: "#EFF5DB", bgOn: "#C1CD91", shadow: "#C1CD91" },
	{ value: "5", label: "Strongly Agree", face: "/faces/5.webp", bg: "#E4F2DB", bgOn: "#B1D995", shadow: "#B1D995" },
];

// One personality question = one funnel step. Selecting a face records it and
// advances the funnel; the funnel header (back) handles navigation.
//
// Layout note: the five options are pinned (shrink-0) and the illustration takes
// the flexible space above them, so on short screens the image shrinks but the
// options are NEVER pushed below the fold.
export function PersonalityStep({
	question,
	selected,
	onAnswer,
}: {
	question: PersonalityItem;
	selected?: string;
	onAnswer: (value: string) => void;
}) {
	return (
		<div className="h-full flex flex-col px-6 pt-3 pb-5">
			{question.image ? (
				<div className="flex-1 min-h-0 flex items-center justify-center py-1">
					<img
						src={question.image}
						alt=""
						aria-hidden="true"
						className="max-h-full w-auto object-contain select-none"
						draggable={false}
					/>
				</div>
			) : (
				<div className="flex-1" />
			)}

			<h2 className="shrink-0 mt-1 text-center text-[23px] font-extrabold leading-tight tracking-[-0.01em] text-[#111]">
				{question.text}
			</h2>

			<div className="shrink-0 mt-4 flex flex-col gap-2.5">
				{SCALE.map((opt) => {
					const on = selected === opt.value;
					return (
						<button
							key={opt.value}
							onClick={() => onAnswer(opt.value)}
							style={{ backgroundColor: on ? opt.bgOn : opt.bg, boxShadow: `0 5px 0 0 ${opt.shadow}` }}
							className="w-full flex items-center gap-3.5 rounded-2xl pl-3.5 pr-6 py-2.5 transition active:translate-y-[2px]"
						>
							<img
								src={opt.face}
								alt=""
								aria-hidden="true"
								className="w-10 h-10 object-contain shrink-0 select-none"
								draggable={false}
							/>
							<span className="text-[17px] font-bold text-[#111]">{opt.label}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
