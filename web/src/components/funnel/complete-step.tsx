import { CHARACTERS } from "./constants";

// Terminal step after the personality test. The plan-reveal flow comes next.
export function CompleteStep({ config }: { config: { title: string; subtitle?: string } }) {
	return (
		<div className="h-full flex flex-col items-center justify-center px-6 py-10 text-center">
			<img
				src={CHARACTERS.cheer}
				alt="Sidekick cheering"
				className="w-40 h-40 object-contain select-none mb-4"
				draggable={false}
			/>
			<h2 className="text-[29px] font-extrabold tracking-[-0.02em] text-[#111]">{config.title}</h2>
			{config.subtitle ? (
				<p className="mt-2 max-w-xs text-[15px] leading-relaxed text-[#111]/55">{config.subtitle}</p>
			) : null}
		</div>
	);
}
