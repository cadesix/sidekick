// Meet — the celebratory full-screen reveal of the sidekick on a soft sky backdrop.
const BTN_MEET =
	"w-full py-4 rounded-full bg-[#5B5BF5] text-white text-[17px] font-bold shadow-[0_5px_0_0_#3F3DD1] transition active:translate-y-[3px] active:shadow-[0_2px_0_0_#3F3DD1]";

export function MeetStep({
	config,
	onDone,
}: {
	config: { cta?: string };
	onDone: () => void;
}) {
	return (
		<div className="h-full flex flex-col px-6 pb-8 bg-gradient-to-b from-[#DDEEFB] to-[#C7E2F7]">
			<div className="flex-1 min-h-0 flex items-center justify-center">
				<img
					src="/meet-sidekick.webp"
					alt="Your sidekick"
					className="max-h-[70%] w-auto max-w-full object-contain select-none animate-fade-up"
					draggable={false}
				/>
			</div>

			<button onClick={onDone} className={BTN_MEET}>
				{config.cta ?? "Let's go!"}
			</button>
		</div>
	);
}
