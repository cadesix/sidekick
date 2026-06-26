import Image from "next/image";
import { FaHandPointer } from "react-icons/fa";
import { LuSparkles, LuStar } from "react-icons/lu";
import { APP_STORE_RATING, COLLECTOR_COUNT, SCANNED_VALUE } from "./constants";
import { ILLUSTRATIONS } from "./illustrations";

type LandingResponse = "not_sure" | "yes";

/** The opening screen — a single compelling question and two taps that both start
 * the quiz. Framing it as a yes/no choice turns the first interaction into a
 * micro-commitment, which converts far better than a lone "Start" button. */
export function LandingStep({ onStart }: { onStart: (response: LandingResponse) => void }) {
	return (
		<div className="flex-1 flex flex-col items-center max-w-md mx-auto w-full px-6 pt-2 pb-8">
			<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold uppercase tracking-[0.12em] px-3 py-1 animate-fade-in-up">
				<LuSparkles className="w-3 h-3" /> Free 30-second quiz
			</span>

			<div className="relative flex-1 flex items-center justify-center w-full my-2">
				<div className="absolute h-56 w-56 rounded-full bg-amber-300/40 blur-3xl" />
				<Image
					src={ILLUSTRATIONS.chest.src}
					alt={ILLUSTRATIONS.chest.alt}
					width={ILLUSTRATIONS.chest.width}
					height={ILLUSTRATIONS.chest.height}
					priority
					unoptimized
					className="relative h-52 w-auto animate-float"
				/>
			</div>

			<h1 className="text-center text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-stone-900 animate-fade-in-up">
				Is there a <span className="italic text-amber-600">small fortune</span> hiding in your home?
			</h1>
			<p className="text-center text-[16px] leading-relaxed text-stone-600 mt-3 animate-fade-in-up">
				Most people own antiques &amp; collectibles worth far more than they think.
			</p>

			<div className="flex items-center justify-center gap-2 mt-4 text-[12px] text-stone-500 animate-fade-in">
				<span className="flex items-center gap-1 font-semibold text-stone-900">
					<LuStar className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
					{APP_STORE_RATING}
				</span>
				<span className="text-stone-300">·</span>
				<span>{COLLECTOR_COUNT} collectors</span>
				<span className="text-stone-300">·</span>
				<span className="font-semibold text-stone-900">{SCANNED_VALUE} found</span>
			</div>

			<div className="relative flex gap-3 w-full mt-6">
				<button
					type="button"
					onClick={() => onStart("not_sure")}
					className="flex-1 flex items-center justify-center gap-2 bg-stone-900 hover:bg-stone-800 active:scale-95 text-white text-base font-semibold py-4 px-5 rounded-full transition-all"
				>
					<span>🤔</span> Not sure
				</button>
				<button
					type="button"
					onClick={() => onStart("yes")}
					className="flex-1 flex items-center justify-center gap-2 bg-stone-900 hover:bg-stone-800 active:scale-95 text-white text-base font-semibold py-4 px-5 rounded-full transition-all"
				>
					<span>👍</span> Definitely!
				</button>
				<FaHandPointer
					aria-hidden
					className="pointer-events-none absolute -bottom-4 right-5 w-8 h-8 text-stone-900 animate-bounce drop-shadow-md"
				/>
			</div>
		</div>
	);
}
