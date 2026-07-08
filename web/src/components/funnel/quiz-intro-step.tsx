import { BTN_PRIMARY } from "./constants";

// Lead-in screen before the personality quiz. The hand-holding-phone illustration
// fills the lower area edge-to-edge and runs behind the Continue button, so the
// button sits directly on the image with no white container around it.
export function QuizIntroStep({
	config,
	onContinue,
}: {
	config: { title: string; body?: string };
	onContinue: () => void;
}) {
	return (
		<div className="relative h-full flex flex-col">
			<div className="shrink-0 px-6 pt-5">
				<h2 className="text-center text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-[#111]">
					{config.title}
				</h2>
				{config.body ? (
					<p className="mt-3 text-center text-[16px] leading-relaxed text-[#111]/55">
						{config.body}
					</p>
				) : null}
			</div>

			{/* Illustration with the phone centered (both axes) and slightly enlarged; the
			    arm runs down behind the button. Positioned by the phone's center in the art. */}
			<div className="flex-1 min-h-0 relative mt-3 overflow-hidden">
				<img
					src="/quiz-intro.webp"
					alt=""
					aria-hidden="true"
					className="absolute left-1/2 top-1/2 w-[112%] max-w-none -translate-x-[32%] -translate-y-[28%] select-none"
					draggable={false}
				/>
			</div>

			{/* Continue overlaid on the image — no white container behind it */}
			<div className="absolute inset-x-0 bottom-0 px-6 pb-8">
				<button onClick={onContinue} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		</div>
	);
}
