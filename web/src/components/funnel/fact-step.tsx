import { useEffect, useRef, useState } from "react";
import { BTN_PRIMARY } from "./constants";

// Mid-quiz insight. A bar graph (other apps vs Sidekick, with a smiley on top of
// the Sidekick bar) grows in first, then the message streams quickly underneath —
// black, with the "8×" highlighted green.
export function FactStep({
	config,
	onContinue,
}: {
	config: { label?: string; title: string };
	onContinue: () => void;
}) {
	const message = config.title;
	const [grown, setGrown] = useState(false);
	const [n, setN] = useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		const grow = setTimeout(() => setGrown(true), 150);
		const start = setTimeout(() => {
			let i = 0;
			intervalRef.current = setInterval(() => {
				i += 2;
				setN(i);
				if (i >= message.length && intervalRef.current) clearInterval(intervalRef.current);
			}, 12);
		}, 950);
		return () => {
			clearTimeout(grow);
			clearTimeout(start);
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [message]);

	// Highlight the "8×" green; everything else black. Render the typed portion in
	// colour and the rest transparent so the layout never jumps.
	const HI = "8×";
	const hStart = message.indexOf(HI);
	const hEnd = hStart >= 0 ? hStart + HI.length : -1;
	const seg = (from: number, to: number, cls: string) => {
		const s = Math.max(from, 0);
		const v = Math.min(to, message.length, n);
		return v > s ? <span className={cls}>{message.slice(s, v)}</span> : null;
	};

	return (
		<div className="h-full flex flex-col px-6 pt-4 pb-8 text-center">
			<div className="flex-1 flex flex-col items-center justify-center">
				{/* Bar graph: other apps vs Sidekick (8×), smiley on the Sidekick bar */}
				<div className="flex items-end justify-center gap-10 mb-9">
					<div className="flex flex-col items-center">
						<div
							className="w-16 rounded-t-xl bg-[#D9DBE2] transition-[height] duration-700 ease-out"
							style={{ height: grown ? 20 : 0 }}
						/>
						<span className="mt-2.5 text-[12px] font-bold leading-tight text-[#111]/45">
							Other apps
						</span>
					</div>
					<div className="flex flex-col items-center">
						<div
							className="relative w-16 rounded-t-xl bg-[#56AE50] transition-[height] duration-[900ms] ease-out"
							style={{ height: grown ? 160 : 0 }}
						>
							<img
								src="/faces/5.webp"
								alt=""
								aria-hidden="true"
								className="absolute left-1/2 -translate-x-1/2 -top-10 w-11 h-11 object-contain transition-opacity duration-300"
								style={{ opacity: grown ? 1 : 0 }}
								draggable={false}
							/>
						</div>
						<span className="mt-2.5 text-[12px] font-bold leading-tight text-[#111]">Sidekick</span>
					</div>
				</div>

				{/* Streaming message — black with green 8× */}
				<p className="max-w-sm text-[25px] font-extrabold leading-snug tracking-[-0.01em]">
					{hStart >= 0 ? (
						<>
							{seg(0, hStart, "text-[#111]")}
							{seg(hStart, hEnd, "text-[#56AE50]")}
							{seg(hEnd, message.length, "text-[#111]")}
						</>
					) : (
						seg(0, message.length, "text-[#111]")
					)}
					<span className="text-transparent">{message.slice(n)}</span>
				</p>
			</div>

			<button onClick={onContinue} className={BTN_PRIMARY}>
				Continue
			</button>
		</div>
	);
}
