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
				<div className="flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1 shadow-[0_2px_10px_rgba(0,0,0,0.18)] backdrop-blur-sm">
					<span className="text-[13px]">🧡</span>
					<span className="text-[12px] font-extrabold tracking-wide text-[#111]">
						Your Bond <span className="tabular-nums">{bond}%</span>
					</span>
				</div>
				<div className="h-1 w-16 overflow-hidden rounded-full bg-black/15">
					<div
						className="h-full rounded-full bg-gradient-to-r from-[#ffb454] to-[#ff7a3d] transition-[width] duration-500 ease-out"
						style={{ width: `${(bond / BOND_MAX) * 100}%` }}
					/>
				</div>
			</div>
		</div>
	);
});
