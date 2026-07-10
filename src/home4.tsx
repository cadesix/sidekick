import { useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { Chat } from "./chat";
import { SidekickCanvas, type CanvasFraming } from "./components/sidekick-canvas";
import { HomeDock } from "./components/home-dock";
import { WorldMap } from "./components/world-map";
import { ShopSheet } from "./components/shop-sheet";
import type { CosmeticsControls } from "./components/sidekick-wardrobe";

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

// Opening the map: the camera rapidly rockets up + back (pull away from the
// meadow) while the world map scales in over it from the centre.
const MAP_FRAMING: CanvasFraming = {
	pos: [0, 5.2, 9.5],
	target: [0, 0.1, 0],
	fov: 54,
};

// Shop open: the meadow is swapped for a clean studio (see `studio`), so the
// character stands on the studio floor (feet at y=0) with a contact shadow. Frame
// the whole body (head to shoes) in the band above the sheet.
const SHOP_FRAMING: CanvasFraming = {
	pos: [0, 0.5, 7.8],
	target: [0, -0.2, 0],
	fov: 26,
};

export default function Home4() {
	const [chatOpen, setChatOpen] = useState(false);
	// `mounted` keeps the drawer in the DOM through its slide-down exit
	const [mounted, setMounted] = useState(false);
	// mapOpen drives the camera pull-back; mapShown drives the map's scale-in, a
	// beat later, so the camera starts flying out before the map grows in.
	const [mapOpen, setMapOpen] = useState(false);
	const [mapShown, setMapShown] = useState(false);
	const [shopOpen, setShopOpen] = useState(false);
	// imperative handle the canvas fills once cosmetics are ready; the Shop uses
	// it to dress the live character
	const controlsRef = useRef<CosmeticsControls | null>(null);

	const open = () => {
		setMounted(true);
		setChatOpen(true);
	};
	const close = () => {
		setChatOpen(false);
		window.setTimeout(() => setMounted(false), 400);
	};

	const openMap = () => {
		setMapOpen(true); // camera rockets up + back immediately
		window.setTimeout(() => setMapShown(true), 60); // circle mask starts expanding almost right away
	};
	const closeMap = () => {
		setMapShown(false); // map scales back out…
		setMapOpen(false); // …while the camera flies back to the meadow
	};

	return (
		<div className="relative h-[100svh] overflow-hidden bg-white">
			{/* Full-viewport 3D scene: sky, lawn, grass, character. The camera eases
			    to CHAT_FRAMING (zoomed out) when the chat drawer opens. */}
			<SidekickCanvas
				className="absolute inset-0"
				framing={mapOpen ? MAP_FRAMING : shopOpen ? SHOP_FRAMING : chatOpen ? CHAT_FRAMING : HERO_FRAMING}
				holdingPhone={chatOpen}
				studio={shopOpen}
				controlsRef={controlsRef}
			/>

			{/* iOS-style home dock — Messages opens the chat sheet. The sheets slide
			    up OVER the dock (higher z-index), so it stays put rather than fading;
			    only the full-screen map reveal hides it. */}
			<HomeDock hidden={mapShown} onMessages={open} onMap={openMap} onShop={() => setShopOpen(true)} />

			{/* Full-screen world map (Map dock icon) — scales in from centre while the
			    camera pulls away behind it */}
			<WorldMap
				open={mapShown}
				onClose={closeMap}
				onChat={() => {
					closeMap();
					open();
				}}
			/>

			{/* Shop sheet (Shop dock icon) — covers the lower half; the character is
			    lifted into the band above so you can see the outfit change live */}
			{shopOpen ? (
				<button
					onClick={() => setShopOpen(false)}
					aria-label="Close shop"
					className="absolute inset-x-0 top-0 bottom-[52%] z-20"
				/>
			) : null}
			<ShopSheet open={shopOpen} onClose={() => setShopOpen(false)} controlsRef={controlsRef} />

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
						className={`absolute inset-x-0 bottom-0 top-[45%] z-40 ${
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
