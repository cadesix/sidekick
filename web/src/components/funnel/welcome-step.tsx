// Welcome — an upside-down Sidekick peeks in from the top edge (only its lower half
// shows), with a big left-aligned headline lower down and the CTA at the bottom.
const BTN_YES =
	"w-full py-4 rounded-full bg-[#4F46F0] text-white text-[17px] font-bold shadow-[0_5px_0_0_#372FC9] transition active:translate-y-[3px] active:shadow-[0_2px_0_0_#372FC9]";

export function WelcomeStep({
	config,
	onStart,
}: {
	config: { title: string; subtitle?: string; cta?: string };
	onStart: () => void;
}) {
	return (
		<div className="h-full overflow-hidden bg-[#DDF2F8] flex flex-col">
			{/* Upside-down Sidekick peeking in, flush with the top edge */}
			<img
				src="/welcome-hero.webp"
				alt=""
				aria-hidden="true"
				className="w-full max-w-md mx-auto object-contain select-none shrink-0"
				draggable={false}
			/>

			<div className="max-w-md mx-auto w-full flex-1 flex flex-col px-7 pb-10">
				{/* Spacer pushes the headline lower, into the open space. */}
				<div className="h-[16%] shrink-0" />

				<h1 className="text-center text-[52px] font-extrabold leading-[0.98] tracking-[-0.035em] text-[#111]">
					{config.title}
				</h1>

				<div className="flex-1" />

				<button onClick={onStart} className={BTN_YES}>
					{config.cta ?? "Yes!"}
				</button>
			</div>
		</div>
	);
}
