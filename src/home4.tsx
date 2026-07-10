import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { Chat } from "./chat";
import { SidekickCanvas, type CanvasFraming } from "./components/sidekick-canvas";
import { HomeDock } from "./components/home-dock";

// Home4: a stripped-back hero. The Three.js scene fills the whole viewport with
// the character centered, and the only UI is the floating chat entrypoint plus
// the chat drawer that slides up over the scene. No header, no goals sheet.

// Front-on framing that centers the full character in a tall phone viewport.
// fov 41.1° ≈ 32 mm full-frame equiv (a touch wider than before), pulled back.
const HERO_FRAMING: CanvasFraming = {
	pos: [0, 0.66, 4.2],
	target: [0, 0.56, 0],
	fov: 41.1,
};

// When the chat drawer is up it covers the lower ~55%, so the camera pulls back
// and lifts the character up so it sits fully in the sky band ABOVE the box.
const CHAT_FRAMING: CanvasFraming = {
	pos: [0, 1.0, 7.7],
	target: [0, -0.55, 0],
	fov: 31,
};

export default function Home4() {
	const [chatOpen, setChatOpen] = useState(false);
	// `mounted` keeps the drawer in the DOM through its slide-down exit
	const [mounted, setMounted] = useState(false);

	const open = () => {
		setMounted(true);
		setChatOpen(true);
	};
	const close = () => {
		setChatOpen(false);
		window.setTimeout(() => setMounted(false), 400);
	};

	return (
		<div className="relative h-[100svh] overflow-hidden bg-white">
			{/* Full-viewport 3D scene: sky, lawn, grass, character. The camera eases
			    to CHAT_FRAMING (zoomed out) when the chat drawer opens. */}
			<SidekickCanvas
				className="absolute inset-0"
				framing={chatOpen ? CHAT_FRAMING : HERO_FRAMING}
				holdingPhone={chatOpen}
			/>

			{/* iOS-style home dock — Messages opens the chat sheet; the dock fades
			    down while the sheet is up (like an app covering the dock) */}
			<HomeDock hidden={chatOpen} onMessages={open} />

			{/* Chat drawer — covers the lower ~55%, leaving the character visible in
			    the band above it. Mounted through the slide-down exit. */}
			{mounted ? (
				<>
					{/* Tap the character band above the drawer to close */}
					<button
						onClick={close}
						aria-label="Close chat"
						className="absolute inset-x-0 top-0 h-[45%] z-30"
					/>
					<div
						className={`absolute inset-x-0 bottom-0 top-[45%] z-20 ${
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
						<Chat transparentTop peekIn={false} />
					</div>
				</>
			) : null}
		</div>
	);
}
