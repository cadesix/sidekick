import Image from "next/image";
import { useEffect, useState } from "react";
import { LuCheck } from "react-icons/lu";
import { captureFunnelEvent, type FunnelContext } from "./analytics";
import { ILLUSTRATIONS } from "./illustrations";

const TOTAL_DURATION = 4500;
const START_FILL = 20;

const LOADING_ITEMS = [
	{ label: "Calculating potential collection value", at: 800 },
	{ label: "Matching against auction records", at: 1900 },
	{ label: "Calculating a confidence-rated value range", at: 3100 },
	{ label: "Building your collection vault", at: 4200 },
];

export function LoadingStep({
	onComplete,
	context,
}: {
	onComplete: () => void;
	context: FunnelContext;
}) {
	const [completedCount, setCompletedCount] = useState(0);
	const [started, setStarted] = useState(false);

	useEffect(() => {
		requestAnimationFrame(() => setStarted(true));
		captureFunnelEvent("funnel_loading_shown", context);

		const timers = LOADING_ITEMS.map((item, i) =>
			setTimeout(() => setCompletedCount(i + 1), item.at),
		);

		const completeTimer = setTimeout(() => {
			captureFunnelEvent("funnel_loading_completed", context);
			onComplete();
		}, TOTAL_DURATION + 500);

		return () => {
			timers.forEach(clearTimeout);
			clearTimeout(completeTimer);
		};
	}, [onComplete]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className="flex flex-col items-center gap-6 px-6 pt-7 pb-7">
			<Image
				src={ILLUSTRATIONS.magnifier.src}
				alt={ILLUSTRATIONS.magnifier.alt}
				width={ILLUSTRATIONS.magnifier.width}
				height={ILLUSTRATIONS.magnifier.height}
				priority
				unoptimized
				className="h-44 w-auto animate-fade-in"
			/>
			<div className="text-center">
				<h2 className="text-[26px] font-semibold text-stone-900">Building your report...</h2>
				<p className="text-stone-500 mt-2">Personalizing for what you collect</p>
			</div>

			<div className="w-full space-y-3">
				{LOADING_ITEMS.map((item, i) => {
					const isDone = i < completedCount;
					const isCurrent = i === completedCount;
					return (
						<div
							key={item.label}
							className="flex items-center gap-3 bg-white border border-stone-200 rounded-xl px-4 py-3 transition-opacity duration-500"
							style={{ opacity: i <= completedCount ? 1 : 0.4 }}
						>
							{isDone ? (
								<div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0">
									<LuCheck className="w-3.5 h-3.5 text-green-600" strokeWidth={2.5} />
								</div>
							) : isCurrent ? (
								<div className="w-6 h-6 shrink-0 flex items-center justify-center">
									<div className="w-4 h-4 border-2 border-stone-300 border-t-stone-800 rounded-full animate-spin" />
								</div>
							) : (
								<div className="w-6 h-6 rounded-full bg-stone-100 shrink-0" />
							)}
							<span
								className={`text-sm ${
									isDone
										? "text-stone-900 font-medium"
										: isCurrent
											? "text-stone-700"
											: "text-stone-400"
								}`}
							>
								{item.label}
							</span>
						</div>
					);
				})}
			</div>

			<div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
				<div
					className="h-full bg-stone-800 rounded-full"
					style={{
						width: started ? "100%" : `${START_FILL}%`,
						transition: `width ${TOTAL_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
					}}
				/>
			</div>
		</div>
	);
}
