import { BTN_PRIMARY, CHARACTERS } from "./constants";

// A simple centered interstitial statement with a Continue button.
export function StatementStep({
	config,
	onContinue,
}: {
	config: { title: string; image?: string; cta?: string };
	onContinue: () => void;
}) {
	return (
		<div className="h-full flex flex-col px-6 pt-4 pb-8">
			<div className="flex-1 flex flex-col items-center justify-center text-center">
				<img
					src={config.image ?? CHARACTERS.cheer}
					alt=""
					aria-hidden="true"
					className="w-60 h-60 object-contain select-none mix-blend-multiply mb-6"
					draggable={false}
				/>
				<h2 className="text-[26px] font-extrabold leading-snug tracking-[-0.01em] text-[#111] whitespace-pre-line">
					{config.title}
				</h2>
			</div>

			<button onClick={onContinue} className={BTN_PRIMARY}>
				{config.cta ?? "Continue"}
			</button>
		</div>
	);
}
