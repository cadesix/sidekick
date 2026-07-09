import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { Chat } from "./chat";
import { SidekickCanvas, type CanvasFraming } from "./components/sidekick-canvas";

// Home4: a stripped-back hero. The Three.js scene fills the whole viewport with
// the character centered, and the only UI is the floating chat entrypoint plus
// the chat drawer that slides up over the scene. No header, no goals sheet.

// Front-on framing that centers the full character in a tall phone viewport.
const HERO_FRAMING: CanvasFraming = {
	pos: [0, 0.64, 3.6],
	target: [0, 0.56, 0],
	fov: 32,
};

export default function Home4() {
	const [chatOpen, setChatOpen] = useState(false);
	// `mounted` keeps the drawer in the DOM through its slide-down exit; `peek`
	// drives the quick fade-in of the peeking Sidekick once it's on its way up.
	const [mounted, setMounted] = useState(false);
	const [peek, setPeek] = useState(false);

	const open = () => {
		setMounted(true);
		setChatOpen(true);
		window.setTimeout(() => setPeek(true), 100);
	};
	const close = () => {
		setChatOpen(false);
		setPeek(false);
		window.setTimeout(() => setMounted(false), 400);
	};

	return (
		<div className="relative h-[100svh] overflow-hidden bg-white">
			{/* Full-viewport 3D scene: sky, lawn, grass, character (centered) */}
			<SidekickCanvas className="absolute inset-0" framing={HERO_FRAMING} />

			{/* Floating chat button (bottom-right) — fades out while the drawer is open */}
			<button
				onClick={open}
				aria-label="Talk to Sidekick"
				className={`absolute bottom-6 right-5 z-30 w-[68px] h-[68px] rounded-full bg-white shadow-[0_5px_0_0_rgba(0,0,0,0.16)] flex items-center justify-center transition-all duration-300 active:translate-y-[2px] active:shadow-[0_3px_0_0_rgba(0,0,0,0.16)] ${
					chatOpen ? "opacity-0 scale-75 pointer-events-none" : "opacity-100 scale-100"
				}`}
			>
				<img src="/chat-tab.webp" alt="" className="w-14 h-14 object-contain" draggable={false} />
			</button>

			{/* Chat drawer — mounted only while open (and during its slide-down exit) */}
			{mounted ? (
				<>
					{/* Tap the strip above the drawer to close */}
					<button
						onClick={close}
						aria-label="Close chat"
						className="absolute inset-x-0 top-0 h-[7%] z-30"
					/>
					<div
						className={`absolute inset-x-0 bottom-0 top-[7%] z-20 ${
							chatOpen ? "animate-sheet-up" : "animate-sheet-down"
						}`}
					>
						<button
							onClick={close}
							aria-label="Close chat"
							className="absolute top-2.5 right-3 z-20 w-9 h-9 rounded-full bg-white/85 shadow-sm flex items-center justify-center active:bg-white"
						>
							<LuChevronDown className="w-5 h-5 text-[#111]/60" strokeWidth={2.5} />
						</button>
						<Chat peekIn={peek} transparentTop peekPop />
					</div>
				</>
			) : null}
		</div>
	);
}
