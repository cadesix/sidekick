import { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuFlame } from "react-icons/lu";
import { StreakModal } from "./components/streak-sheet";
import { touchStreak } from "./components/sidekick-streak";
import { Chat } from "./chat";
import { AppearanceSheet } from "./components/appearance-sheet";
import { BondBadge } from "./components/bond-badge";
import { SidekickAvatar } from "./components/sidekick-avatar";
import { SidekickCanvas, type CanvasFraming, type SidekickCanvasHandle } from "./components/sidekick-canvas";
import type { EnvironmentId } from "./components/sidekick-biomes";
import { DevPanel } from "./components/dev-panel";
import { applyPersonaFromUrl } from "./components/sidekick-profile";
import { GoalsSheet } from "./components/goals-sheet";
import { HomeDock } from "./components/home-dock";
import { WorldMap } from "./components/world-map";
import { ShopSheet } from "./components/shop-sheet";
import type { CosmeticsControls } from "./components/sidekick-wardrobe";
import { SpeechBubble, speak } from "./components/speech-bubble";
import { loadUnread, pushSidekickMessage, subscribeUnread } from "./components/sidekick-inbox";

// Home5: home4 with a full-sheet iMessage chat. Tapping Messages slides a
// full-screen conversation up while the 3D scene shrinks into a FaceTime-style
// PiP circle at the top-center (the onboarding chat pattern) — the UI surface
// we're iterating on for the main chat experience.

// Front-on framing that centers the full character in a tall phone viewport.
// fov 41.1° ≈ 32 mm full-frame equiv (a touch wider than before), pulled back.
const HERO_FRAMING: CanvasFraming = {
	pos: [0, 0.66, 4.2],
	target: [0, 0.56, 0],
	fov: 41.1,
};

// When the chat drawer is up it covers the lower ~55%, so the camera pulls back
// and lifts the character up so it sits fully in the sky band ABOVE the box.
// chat: the sheet covers ~86%, so the camera pulls way back and aims low —
// the whole standing character composes into the top sliver of the screen
const CHAT_FRAMING: CanvasFraming = {
	pos: [0, 1.6, 13],
	target: [0, -2.0, 0],
	fov: 30,
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

// The sidekick's arrival reaction per destination — popped in the overhead
// speech bubble and sent as a text push (which badges the Messages tile).
const TRAVEL_LINES: Record<EnvironmentId, string> = {
	meadow: "ahh home sweet meadow 🌼",
	snow: "brrr it's FREEZING up here ❄️ worth it for the view though",
	forest: "ooh it smells so good here 🌲 pine trees hit different",
	blossom: "petals everywhere!! 🌸 this might be my favorite spot",
	desert: "oh it's HOT here 🥵 like, really hot",
	tropical: "beach day!!! 🌴 you can literally hear the waves",
	volcano: "uhh is that lava?? 🌋 this is fine. we're fine.",
};

// dev: /home4?persona=week2 boots straight into a canned user state
if (import.meta.env.DEV) applyPersonaFromUrl();

export default function Home5() {
	const [chatOpen, setChatOpen] = useState(false);
	// `mounted` keeps the drawer in the DOM through its slide-down exit
	const [mounted, setMounted] = useState(false);
	// mapOpen drives the camera pull-back; mapShown drives the map's scale-in, a
	// beat later, so the camera starts flying out before the map grows in.
	const [mapOpen, setMapOpen] = useState(false);
	const [mapShown, setMapShown] = useState(false);
	const [shopOpen, setShopOpen] = useState(false);
	const [goalsOpen, setGoalsOpen] = useState(false);
	const [streakOpen, setStreakOpen] = useState(false);
	// counts today on app open (idempotent per local day)
	const [streak] = useState(() => touchStreak());
	// unread sidekick pushes — badge on the dock's Messages tile; the Chat
	// component clears the count when it mounts
	const [unread, setUnread] = useState(loadUnread);
	useEffect(() => subscribeUnread(setUnread), []);
	// which world the character stands in — map travel swaps it while the map
	// still covers the screen, so the new biome is there when the reveal closes
	const [environment, setEnvironment] = useState<EnvironmentId>("meadow");
	// pause the 3D scene once the near-full-screen shop has covered it (after
	// the slide-up + studio crossfade settle) — frees the GPU for the turntables
	const [canvasPaused, setCanvasPaused] = useState(false);
	useEffect(() => {
		if (!shopOpen) {
			setCanvasPaused(false);
			return;
		}
		const t = window.setTimeout(() => setCanvasPaused(true), 450);
		return () => window.clearTimeout(t);
	}, [shopOpen]);
	// imperative handle the canvas fills once cosmetics are ready; the Shop uses
	// it to dress the live character
	const controlsRef = useRef<CosmeticsControls | null>(null);
	// the Bond badge element the canvas pins over the character's head
	const bondRef = useRef<HTMLDivElement | null>(null);
	// imperative canvas handle — the Appearance sheet recolors the live character
	const canvasHandleRef = useRef<SidekickCanvasHandle | null>(null);
	const [appearanceOpen, setAppearanceOpen] = useState(false);

	// set when "Talk about it" opens a goal in chat — auto-sent once on mount
	const [chatSeed, setChatSeed] = useState<string | undefined>(undefined);

	const open = () => {
		setMounted(true);
		setChatOpen(true);
	};
	const close = () => {
		setChatOpen(false);
		window.setTimeout(() => {
			setMounted(false);
			setChatSeed(undefined);
		}, 400);
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
				framing={mapOpen ? MAP_FRAMING : shopOpen || appearanceOpen ? SHOP_FRAMING : chatOpen ? CHAT_FRAMING : HERO_FRAMING}
				holdingPhone={chatOpen}
				studio={shopOpen || appearanceOpen}
				environment={environment}
				controlsRef={controlsRef}
				overheadRef={bondRef}
				handleRef={canvasHandleRef}
				paused={canvasPaused}
			/>

			{/* Overhead stack floating over the character's head (canvas positions
			    it): speech bubble on top, Bond score pill under it */}
			<BondBadge ref={bondRef}>
				<SpeechBubble />
			</BondBadge>

			{/* dev-only user-state panel: personas + individual state dials */}
			{import.meta.env.DEV ? <DevPanel /> : null}

			{/* top right: appearance (avatar) + streak */}
			<div
				className={`absolute right-4 top-[max(env(safe-area-inset-top),16px)] z-30 flex items-center gap-2 transition-all duration-300 ${
					mapShown ? "pointer-events-none opacity-0" : ""
				}`}
			>
				<button
					onClick={() => setAppearanceOpen(true)}
					aria-label="Appearance"
					className="grid h-10 w-10 place-items-center rounded-full bg-white/85 shadow-[0_3px_0_rgba(0,0,0,0.12)] backdrop-blur-sm transition-all duration-100 active:translate-y-[2px] active:shadow-[0_1px_0_rgba(0,0,0,0.12)]"
				>
					<SidekickAvatar className="h-10 w-10 scale-110 object-contain" alt="Appearance" />
				</button>
				<button
					onClick={() => setStreakOpen(true)}
					aria-label="Streak"
					className="flex items-center gap-1.5 rounded-full bg-white/85 px-3.5 py-2 shadow-[0_3px_0_rgba(0,0,0,0.12)] backdrop-blur-sm transition-all duration-100 active:translate-y-[2px] active:shadow-[0_1px_0_rgba(0,0,0,0.12)]"
				>
					<LuFlame className="h-5 w-5 text-[#ff7a3d]" strokeWidth={2.5} />
					<span className="text-[14px] font-extrabold tabular-nums text-[#111]">{streak}</span>
				</button>
			</div>

			{/* iOS-style home dock — Messages opens the chat sheet. The sheets slide
			    up OVER the dock (higher z-index), so it stays put rather than fading;
			    only the full-screen map reveal hides it. */}
			<HomeDock
				hidden={mapShown}
				unread={unread}
				onMessages={open}
				onMap={openMap}
				onShop={() => setShopOpen(true)}
				onGoals={() => setGoalsOpen(true)}
			/>

			{/* Full-screen world map (Map dock icon) — scales in from centre while the
			    camera pulls away behind it */}
			<WorldMap
				open={mapShown}
				onClose={closeMap}
				onChat={() => {
					closeMap();
					open();
				}}
				onTravel={(biome) => {
					setEnvironment(biome);
					closeMap();
					const line = TRAVEL_LINES[biome];
					// the push (and its badge) lands right away; the bubble waits for
					// the map reveal to shrink so the line pops over a visible character
					pushSidekickMessage(line);
					window.setTimeout(() => speak(line), 650);
				}}
			/>

			{/* Shop sheet (Shop dock icon) — covers the lower half; the character is
			    lifted into the band above so you can see the outfit change live */}
			{shopOpen ? (
				<button
					onClick={() => setShopOpen(false)}
					aria-label="Close shop"
					className="absolute inset-x-0 top-0 bottom-[92%] z-20"
				/>
			) : null}
			<ShopSheet open={shopOpen} onClose={() => setShopOpen(false)} controlsRef={controlsRef} />

			{/* Goals sheet (Goals dock icon) — the user's goals with this week's
			    habit check-offs; tap the band above to dismiss */}
			{goalsOpen ? (
				<button
					onClick={() => setGoalsOpen(false)}
					aria-label="Close goals"
					className="absolute inset-x-0 top-0 bottom-[62%] z-20"
				/>
			) : null}
			{/* Streak modal — current streak + the next few milestone rewards */}
			<StreakModal open={streakOpen} onClose={() => setStreakOpen(false)} streak={streak} />

			{/* Appearance sheet (avatar button) — skin color + the closet */}
			{appearanceOpen ? (
				<button
					onClick={() => setAppearanceOpen(false)}
					aria-label="Close appearance"
					className="absolute inset-x-0 top-0 bottom-[52%] z-20"
				/>
			) : null}
			<AppearanceSheet
				open={appearanceOpen}
				onClose={() => setAppearanceOpen(false)}
				controlsRef={controlsRef}
				onSkin={(c) => canvasHandleRef.current?.setColors(c.body, c.shadow)}
			/>

			<GoalsSheet
				open={goalsOpen}
				onClose={() => setGoalsOpen(false)}
				onTalk={(label) => {
					setGoalsOpen(false);
					setChatSeed(`I want to talk about my goal: ${label}`);
					open();
				}}
			/>

			{/* Chat drawer — covers the lower ~55%, leaving the character visible in
			    the band above it. Mounted through the slide-down exit. */}
			{mounted ? (
				<>
					{/* tap the scene sliver to close */}
					<button onClick={close} aria-label="Close chat" className="absolute inset-x-0 top-0 z-30 h-[20%]" />
					<div
						className={`absolute inset-x-0 bottom-0 top-[20%] z-40 overflow-hidden rounded-t-[28px] bg-[#FBEFC9] shadow-[0_-8px_40px_rgba(0,0,0,0.22)] ${
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
						<Chat transparentTop peekIn={false} seed={chatSeed} />
					</div>
				</>
			) : null}
		</div>
	);
}
