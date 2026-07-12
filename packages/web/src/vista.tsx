import { SidekickCanvas, type CanvasFraming } from "./components/sidekick-canvas";

// /vista — the cinematic 9:16 hero: the character on a grassy ledge, a big cliff
// anchoring the foreground-left, and the ground dropping away to a river, distant
// hills, and hazy mountains. Full-viewport landscape backdrop.

// Framing: camera front-right and a touch high, looking out over the valley and
// slightly toward the cliff, so the cliff fills the left and the vista recedes.
const VISTA_FRAMING: CanvasFraming = {
	pos: [1.0, 2.6, 8.6],
	target: [-1.7, 1.1, -6],
	fov: 54,
};

export default function Vista() {
	return (
		<div className="relative h-[100svh] overflow-hidden bg-black">
			<SidekickCanvas className="absolute inset-0" framing={VISTA_FRAMING} landscape />
		</div>
	);
}
