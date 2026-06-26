import Image from "next/image";
import { LuCamera, LuChartArea, LuSearch, LuZap } from "react-icons/lu";
import { ILLUSTRATIONS } from "./illustrations";
import { PERSONA_ARCHETYPE, PERSONA_WORD, resolvePersona } from "./persona";
import { RatingBar } from "./rating-bar";
import type { FunnelAnswers } from "./types";

const ITEM_LABELS: Record<string, string> = {
	furniture: "Furniture",
	jewelry: "Jewelry & watches",
	coins: "Coins & currency",
	art: "Art & prints",
	ceramics: "Ceramics & glass",
	toys: "Toys & collectibles",
	militaria: "Militaria",
	tools: "Tools",
	other: "Hidden gems",
};

const CAPABILITIES = [
	{
		icon: LuCamera,
		title: "Instant AI identification",
		description: "Maker, era, materials, and origin from a single photo — no expertise needed.",
	},
	{
		icon: LuChartArea,
		title: "Real market valuations",
		description: "Value ranges built from actual auction results and completed sales.",
	},
	{
		icon: LuZap,
		title: "Unlimited scans",
		description: "Catalog your whole collection into one searchable vault.",
	},
	{
		icon: LuSearch,
		title: "Comparable sales",
		description: "See what similar items actually sold for, instantly.",
	},
];

// A teased value range anchored to the user's own "most valuable item" guess,
// nudged upward to land the funnel's core promise ("worth more than you think").
// Deliberately a population-level estimate, labelled as such — the real number
// comes from scanning, which is the thing we're selling.
const VALUE_RANGE_BY_STAKES: Record<string, string> = {
	"under-50": "$100 – $1,500",
	"50-500": "$500 – $4,000",
	"500-5000": "$2,500 – $15,000",
	"over-5000": "$10,000+",
	"no-idea": "$500 – $5,000",
};

function estimatedValueRange(answers: FunnelAnswers): string {
	const stakes = typeof answers.stakes === "string" ? answers.stakes : "";
	return VALUE_RANGE_BY_STAKES[stakes] ?? "$500 – $5,000";
}

function selectedItemLabels(answers: FunnelAnswers): string[] {
	const items = answers.items;
	if (!Array.isArray(items)) {
		return [];
	}
	return items.slice(0, 4).map((value) => ITEM_LABELS[value] ?? value);
}

export function ResultsStep({ answers }: { answers: FunnelAnswers }) {
	const persona = resolvePersona(answers.persona);
	const focus = selectedItemLabels(answers);
	const valueRange = estimatedValueRange(answers);

	return (
		<div className="flex flex-col max-h-full">
			<div className="overflow-y-auto min-h-0 px-6 pt-7 pb-2">
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 mb-1.5">
					Your collector profile
				</p>
				<h2 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-stone-900 mb-1.5">
					{PERSONA_ARCHETYPE[persona]}
				</h2>
				<p className="text-[14px] leading-relaxed text-stone-500 mb-4">
					Based on your answers, here&rsquo;s what Relic unlocks for you.
				</p>

				<Image
					src={ILLUSTRATIONS.blueVase.src}
					alt={ILLUSTRATIONS.blueVase.alt}
					width={ILLUSTRATIONS.blueVase.width}
					height={ILLUSTRATIONS.blueVase.height}
					priority
					unoptimized
					className="h-40 w-auto mx-auto mb-4 animate-fade-in"
				/>

				<div className="text-center mb-4 animate-fade-in">
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 mb-1.5">
						Estimated collection value
					</p>
					<p className="text-[38px] font-bold leading-none tracking-tight text-green-600">
						{valueRange}
					</p>
					<p className="text-[13px] leading-relaxed text-stone-500 mt-2">
						Estimated from what {PERSONA_WORD[persona]} like you tend to own. Scan your items to
						replace this with real, confidence-rated values.
					</p>
				</div>

				<div className="space-y-3">
					{focus.length > 0 ? (
						<div className="flex flex-wrap gap-1.5">
							{focus.map((label) => (
								<span
									key={label}
									className="text-xs font-medium text-stone-700 bg-stone-100 rounded-full px-2.5 py-1"
								>
									{label}
								</span>
							))}
						</div>
					) : null}

					<p className="text-xs font-medium text-stone-400 uppercase tracking-wide pt-1">
						What&rsquo;s inside
					</p>

					{CAPABILITIES.map((capability, i) => {
						const Icon = capability.icon;
						return (
							<div
								key={capability.title}
								className="flex gap-4 p-3.5 bg-stone-50 rounded-2xl animate-fade-in-right"
								style={{ animationDelay: `${i * 80}ms` }}
							>
								<div className="w-10 h-10 rounded-full bg-stone-900 text-white flex items-center justify-center shrink-0">
									<Icon className="w-5 h-5" />
								</div>
								<div>
									<p className="font-medium text-stone-900">{capability.title}</p>
									<p className="text-sm text-stone-500 mt-0.5">{capability.description}</p>
								</div>
							</div>
						);
					})}

					<RatingBar />
				</div>
			</div>
		</div>
	);
}
