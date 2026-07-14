import { useState } from "react";
import { SidekickCanvas, type CanvasFraming } from "./components/sidekick-canvas";
import type { EnvironmentId } from "./components/sidekick-biomes";

// Dev preview for the travel biomes (/biomes). Renders the full interactive
// character in each environment with a simple switcher, so we can tune the look
// before wiring the map→travel flow. Framing matches the meadow hero.
// a wider cinematic establishing shot so the environment + foreground framing read
const FRAMING: CanvasFraming = {
	pos: [0, 1.35, 6.4],
	target: [0, 0.45, 0],
	fov: 48,
};

const ENVS: { id: EnvironmentId; label: string }[] = [
	{ id: "meadow", label: "Meadow" },
	{ id: "snow", label: "Snow" },
	{ id: "desert", label: "Desert" },
	{ id: "forest", label: "Forest" },
	{ id: "blossom", label: "Blossom" },
	{ id: "tropical", label: "Tropical" },
	{ id: "volcano", label: "Volcano" },
];

export default function BiomesPreview() {
	// ?env=blossom preselects a biome (handy for scripted screenshots)
	const [env, setEnv] = useState<EnvironmentId>(() => {
		const q = new URLSearchParams(window.location.search).get("env") as EnvironmentId | null;
		return q && ENVS.some((e) => e.id === q) ? q : "snow";
	});
	return (
		<div className="relative h-[100svh] overflow-hidden bg-white">
			<SidekickCanvas className="absolute inset-0" framing={FRAMING} environment={env} />
			{/* cinematic vignette: darken the corners + a subtle top-down grade */}
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					background:
						"radial-gradient(120% 80% at 50% 42%, transparent 55%, rgba(0,0,0,0.28) 100%), linear-gradient(to bottom, rgba(0,0,0,0.12), transparent 22%, transparent 78%, rgba(0,0,0,0.18))",
				}}
			/>
			<div className="absolute inset-x-0 bottom-0 flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),20px)]">
				<div className="no-scrollbar flex max-w-full gap-2 overflow-x-auto rounded-full bg-white/25 p-2 shadow-lg backdrop-blur-xl">
					{ENVS.map((e) => (
						<button
							key={e.id}
							onClick={() => setEnv(e.id)}
							className={`shrink-0 rounded-full px-4 py-2 text-[15px] font-bold transition ${
								env === e.id ? "bg-neutral-900 text-white" : "bg-white/70 text-neutral-700 active:bg-white"
							}`}
						>
							{e.label}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
