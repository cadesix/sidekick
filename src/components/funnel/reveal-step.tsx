// Reveal — sidekick still in silhouette, building anticipation before the meet.
const BTN_REVEAL =
	"w-full py-4 rounded-full bg-[#5B5BF5] text-white text-[17px] font-bold shadow-[0_5px_0_0_#3F3DD1] transition active:translate-y-[3px] active:shadow-[0_2px_0_0_#3F3DD1]";

export function RevealStep({
	config,
	onContinue,
}: {
	config: { title: string; subtitle?: string; cta?: string };
	onContinue: () => void;
}) {
	return (
		<div className="h-full flex flex-col items-center px-6 pt-8 pb-8 text-center">
			<div className="flex-1 min-h-0 flex flex-col items-center justify-center">
				<h1 className="text-[56px] font-black leading-none tracking-[-0.02em] text-[#111] -rotate-[20deg]">
					{config.title}
				</h1>

				<img
					src="/sidekick-silhouette.webp"
					alt=""
					aria-hidden="true"
					className="animate-shake-soft my-7 max-h-[42vh] w-auto object-contain select-none"
					draggable={false}
				/>

				{config.subtitle ? (
					<h2 className="text-[30px] font-extrabold leading-tight tracking-[-0.01em] text-[#111]">
						{config.subtitle}
					</h2>
				) : null}
			</div>

			<div className="w-full animate-shake-strong">
				<button onClick={onContinue} className={BTN_REVEAL}>
					{config.cta ?? "Continue"}
				</button>
			</div>
		</div>
	);
}
