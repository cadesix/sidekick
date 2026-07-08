import { BTN_PRIMARY, CHARACTERS } from "./constants";
import { computePersonality } from "./personality";

// Final screen: compute the user's archetype from the quiz answers and reveal it.
export function ResultStep({
	answers,
	onContinue,
}: {
	answers?: Record<string, string>;
	onContinue: () => void;
}) {
	const p = computePersonality(answers);

	// Per-archetype illustration (falls back to the default Sidekick if not yet drawn).
	const slug = p.name.replace(/^The\s+/i, "").toLowerCase().replace(/\s+/g, "-");

	// Friendly, brand-flavoured labels for the underlying Big Five traits.
	const bars = [
		{ label: "Curiosity", pct: p.percents.O },
		{ label: "Drive", pct: p.percents.C },
		{ label: "Energy", pct: p.percents.E },
		{ label: "Warmth", pct: p.percents.A },
		{ label: "Calm", pct: 100 - p.percents.N },
	];

	// Split the blurb into its sentences so it reads as short paragraphs.
	const paragraphs = p.blurb.split(/(?<=[.!?])\s+/).filter(Boolean);

	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 overflow-y-auto px-7 pt-2 pb-4">
				<div className="flex justify-center">
					<img
						src={`/types/${slug}.webp`}
						alt=""
						aria-hidden="true"
						className="w-48 h-48 object-contain select-none"
						draggable={false}
						onError={(e) => {
							e.currentTarget.src = CHARACTERS.cheer;
						}}
					/>
				</div>

				<p className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-[#3B62E5]">
					You are
				</p>
				<h1 className="mt-1 text-[44px] font-extrabold italic leading-[0.95] tracking-[-0.02em] text-[#111]">
					{p.name}
				</h1>
				<p className="mt-2 text-[20px] font-bold text-[#3B62E5]">{p.tagline}</p>

				<div className="mt-6 space-y-4">
					{paragraphs.map((para, i) => (
						<p key={i} className="text-[19px] font-bold leading-snug text-[#111]">
							{para}
						</p>
					))}
				</div>

				<div className="mt-7 rounded-3xl bg-[#F4FBFF] px-5 py-5">
					<div className="space-y-3.5">
						{bars.map((b) => (
							<div key={b.label} className="flex items-center gap-4">
								<span className="w-[72px] text-[16px] font-bold text-[#111]">{b.label}</span>
								<div className="flex-1 h-2.5 rounded-full bg-[#F3F4F6] overflow-hidden">
									<div
										className="h-full rounded-full bg-[#3B62E5]"
										style={{ width: `${b.pct}%` }}
									/>
								</div>
								<span className="w-11 text-right text-[16px] font-bold tabular-nums text-[#111]">
									{b.pct}%
								</span>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="px-6 pt-3 pb-8">
				<button onClick={onContinue} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		</div>
	);
}
