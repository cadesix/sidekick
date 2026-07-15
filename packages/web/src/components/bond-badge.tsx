import { forwardRef, useEffect, useRef, useState } from "react";
import { BOND_MAX, loadBond, subscribeBond } from "./sidekick-bond";

// Floating "Bond" score pinned over the character's head. The canvas positions
// the outer div every frame (overheadRef → 3D head-bone projection), so this
// component only owns the pill's look: value, progress fill, and a springy pop
// whenever the score goes up. Children render stacked ABOVE the pill in the
// same head-tracked container (e.g. the speech bubble).
export const BondBadge = forwardRef<HTMLDivElement, { children?: React.ReactNode }>(function BondBadge({ children }, ref) {
	const [bond, setBond] = useState(loadBond);
	const [pop, setPop] = useState(false);
	const popTimer = useRef(0);
	useEffect(() => {
		const unsub = subscribeBond((v) => {
			setBond(v);
			setPop(true);
			window.clearTimeout(popTimer.current);
			popTimer.current = window.setTimeout(() => setPop(false), 350);
		});
		return () => {
			unsub();
			window.clearTimeout(popTimer.current);
		};
	}, []);

	return (
		<div
			ref={ref}
			className="pointer-events-none absolute left-0 top-0 z-10 flex flex-col items-center gap-1.5"
			style={{ visibility: "hidden" }}
		>
			{children}
			<div
				className="flex flex-col items-center gap-1 transition-transform duration-300"
				style={{ transform: pop ? "scale(1.18)" : "scale(1)", transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}
			>
				{/* heart + label float directly on the scene (no pill); white text
				    with a soft shadow so it reads on any biome */}
				<div className="flex items-center gap-1.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]">
					<img
						src="/icons/bond.png"
						alt=""
						draggable={false}
						className="h-6 w-6 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
					/>
					<span className="font-mono text-[14px] font-bold lowercase tracking-tight text-white">
						bond score <span className="tabular-nums">{bond}%</span>
					</span>
				</div>
				{/* wide inset track with an amber gradient fill (rounded caps) */}
				<div className="mt-0.5 h-2.5 w-40 rounded-full bg-black/25 p-[2px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
					<div
						className="h-full rounded-full bg-gradient-to-b from-[#ffd36b] to-[#ff9b2b] shadow-[0_0_6px_rgba(255,170,60,0.6)] transition-[width] duration-500 ease-out"
						style={{ width: `${(bond / BOND_MAX) * 100}%` }}
					/>
				</div>
			</div>
		</div>
	);
});
