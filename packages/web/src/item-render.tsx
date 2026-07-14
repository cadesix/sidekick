import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DEFAULT_SETTINGS, type SidekickSettings } from "./components/sidekick-settings";
import { MODEL_URL } from "./components/sidekick-shading";
import { createCosmetics } from "./components/sidekick-equipment";
import { SHOP_COLORS, WARDROBE_SLOTS } from "./components/sidekick-wardrobe";

// Dev-only product-shot factory for the Shop (/item-render). Loads the rigged
// character, hides its body/face, then walks the whole catalog — every slot ×
// variant plus every slot × solid color — equipping each item on the invisible
// rig (so it keeps its worn shape), auto-framing it, and POSTing a transparent
// 512² PNG to the vite plugin, which writes public/shop-renders/<name>.png.
// The Shop's product cards pick these up automatically (they fall back to raw
// textures when a render is missing). Re-run the route after adding items.

const SIZE = 512;
const VIEW_DIR = new THREE.Vector3(1, 0.42, 1).normalize(); // 3/4 hero angle
// torso garments read best straight-on (the model faces +X raw)
const FRONT_DIR = new THREE.Vector3(1, 0.12, 0).normalize();
const FRONT_SLOTS = new Set(["shirt", "hoodie"]);

// Render with the PROD look — the cel-bloom-tilt-5173 checked-in preset — not
// whatever localStorage this browser happens to have (headless runs have none,
// which would silently fall back to defaults and mismatch the app).
const PROD_PRESET =
	Object.entries(
		import.meta.glob<Partial<SidekickSettings>>("./config-presets/*.json", { eager: true, import: "default" }),
	).find(([path]) => path.includes("cel-bloom-tilt-5173"))?.[1] ?? {};
// …but pinned to the DAY scene: the preset ships timeOfDay "evening", whose warm
// charTint would bake a sunset cast into every product shot (grey reads brown,
// sky reads navy). Day's charTint is white, so items keep their true colors.
const RENDER_SETTINGS: SidekickSettings = { ...DEFAULT_SETTINGS, ...PROD_PRESET, timeOfDay: "day" };

export default function ItemRender() {
	const mountRef = useRef<HTMLDivElement>(null);
	const [log, setLog] = useState<string[]>([]);
	const [status, setStatus] = useState("loading character…");

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		let cancelled = false;

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
		renderer.setSize(SIZE, SIZE);
		renderer.setPixelRatio(1);
		renderer.setClearColor(0x000000, 0); // transparent product shots
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		mount.appendChild(renderer.domElement);
		scene.add(new THREE.HemisphereLight("#ffffff", "#c8cbd8", 0.9));
		const key = new THREE.DirectionalLight("#fff4dc", 1.6);
		key.position.set(3, 4, 3);
		scene.add(key);
		const fill = new THREE.DirectionalLight("#a9c9ff", 0.55);
		fill.position.set(-3, 1, 2);
		scene.add(fill);

		const push = (line: string) => setLog((xs) => [...xs.slice(-40), line]);
		const raf = () => new Promise((r) => requestAnimationFrame(r));

		(async () => {
			const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
			const model = gltf.scene;
			scene.add(model);
			let bodyMesh: THREE.SkinnedMesh | null = null;
			const charMeshes: THREE.Mesh[] = [];
			model.traverse((c) => {
				if (c instanceof THREE.SkinnedMesh) {
					charMeshes.push(c);
					c.frustumCulled = false;
					if ((c.material as THREE.MeshStandardMaterial).map) bodyMesh = c;
				}
			});
			if (!bodyMesh) {
				setStatus("no textured body mesh in GLB");
				return;
			}
			// items shade exactly like in-game (cel etc. from the saved look-dev
			// settings); the character itself is hidden so items float in worn shape
			const cos = createCosmetics(bodyMesh, RENDER_SETTINGS, null);
			await cos.ready;
			if (cancelled) return;
			for (const c of charMeshes) c.visible = false;

			const manifest = cos.slots();
			let saved = 0;
			let failed = 0;

			const shoot = async (name: string, dir: THREE.Vector3) => {
				// a few frames so freshly-loaded textures/materials are applied
				for (let i = 0; i < 4; i++) await raf();
				const box = new THREE.Box3();
				for (const m of cos.targets()) box.expandByObject(m);
				if (box.isEmpty()) {
					failed++;
					push(`✗ ${name} (nothing equipped)`);
					return;
				}
				const center = box.getCenter(new THREE.Vector3());
				const span = box.getSize(new THREE.Vector3()).length() || 0.2;
				const dist = (span / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.2;
				camera.position.copy(center).addScaledVector(dir, dist);
				camera.lookAt(center);
				renderer.render(scene, camera);
				const dataUrl = renderer.domElement.toDataURL("image/png");
				try {
					const r = await fetch("/api/sidekick/shop-render", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name, dataUrl }),
					});
					if (!r.ok) throw new Error(String(r.status));
					saved++;
					push(`✓ ${name}`);
				} catch (e) {
					failed++;
					push(`✗ ${name} (${String(e)})`);
				}
			};

			// ?slots=shirt,hoodie re-renders a subset without redoing the catalog
			const only = new URLSearchParams(window.location.search).get("slots")?.split(",");
			for (const slot of WARDROBE_SLOTS) {
				const def = manifest[slot];
				if (!def || (only && !only.includes(slot))) continue;
				const dir = FRONT_SLOTS.has(slot) ? FRONT_DIR : VIEW_DIR;
				setStatus(`rendering ${slot}…`);
				for (const v of def.variants) {
					if (cancelled) return;
					await cos.equip(slot, v.id);
					await shoot(`${slot}-${v.id}`, dir);
				}
				for (const c of SHOP_COLORS) {
					if (cancelled) return;
					await cos.equip(slot, def.variants[0].id);
					cos.setColor(slot, c);
					await shoot(`${slot}-c${c.slice(1)}`, dir);
				}
				cos.unequip(slot);
			}
			setStatus(`finished — ${saved} saved, ${failed} failed`);
		})().catch((e) => setStatus(`error: ${String(e)}`));

		return () => {
			cancelled = true;
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, []);

	return (
		<div className="flex min-h-screen items-start gap-6 bg-neutral-900 p-6 text-white">
			<div>
				<div className="mb-2 text-sm font-bold">{status}</div>
				<div ref={mountRef} className="h-[512px] w-[512px] rounded-xl bg-[repeating-conic-gradient(#2a2a2a_0%_25%,#333_0%_50%)] bg-[length:24px_24px]" />
			</div>
			<pre className="max-h-[80vh] overflow-y-auto text-xs leading-5 text-neutral-300">{log.join("\n")}</pre>
		</div>
	);
}
