import { useEffect, useRef, useState } from "react";

const EVT = "sidekick:speak";

// Pop a short line in the speech bubble above the character's head.
// Fire-and-forget; a new line replaces whatever is currently showing.
export function speak(text: string, ms = 4500) {
	window.dispatchEvent(new CustomEvent(EVT, { detail: { text, ms } }));
}

// The bubble itself. Render it inside the canvas-pinned overhead stack (a
// BondBadge child), so it tracks the head for free and sits above the Bond
// pill. Springs in on speak(), fades back out after `ms`.
export function SpeechBubble() {
	const [text, setText] = useState<string | null>(null);
	const [shown, setShown] = useState(false);
	const timers = useRef<number[]>([]);

	useEffect(() => {
		const on = (e: Event) => {
			const { text: t, ms } = (e as CustomEvent<{ text: string; ms: number }>).detail;
			timers.current.forEach((id) => window.clearTimeout(id));
			timers.current = [];
			setText(t);
			// double-rAF so a replacement line still transitions from scale-75
			requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
			timers.current.push(window.setTimeout(() => setShown(false), ms));
			timers.current.push(window.setTimeout(() => setText(null), ms + 300));
		};
		window.addEventListener(EVT, on);
		return () => {
			window.removeEventListener(EVT, on);
			timers.current.forEach((id) => window.clearTimeout(id));
		};
	}, []);

	if (text === null) return null;
	return (
		<div
			className={`flex flex-col items-center transition-all duration-300 ${
				shown ? "scale-100 opacity-100" : "scale-75 opacity-0"
			}`}
			style={{ transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)" }}
		>
			<div className="max-w-[230px] rounded-2xl bg-white/95 px-3.5 py-2 text-center text-[13px] font-bold leading-snug text-[#111] shadow-[0_2px_10px_rgba(0,0,0,0.18)] backdrop-blur-sm">
				{text}
			</div>
			{/* little tail pointing down at the head */}
			<div className="-mt-[5px] h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white/95" />
		</div>
	);
}
