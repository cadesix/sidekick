import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { createCosmetics } from "./sidekick-equipment";
import { loadSettings, type SidekickSettings } from "./sidekick-settings";
import { MODEL_URL } from "./sidekick-shading";

// Live spinning product shot for the Shop's featured cards. Loads the rigged
// character once (module-cached), clones it per card (SkeletonUtils — plain
// .clone() breaks skinned bone bindings), equips the product on the invisible
// rig so garments keep their worn shape, auto-frames it, and slowly turns it.
// Runs at ~30fps only while mounted — the Shop mounts these only while open.

let charPromise: Promise<GLTF> | null = null;
// module-cached rigged-character load, shared with the avatar snapshot service
export const loadChar = () => (charPromise ??= new GLTFLoader().loadAsync(MODEL_URL));

// present products in neutral daylight (matches the static shop renders): the
// active preset may live in evening, whose warm tint distorts item colors
function turntableSettings(): SidekickSettings {
	return { ...loadSettings(), timeOfDay: "day" };
}

export function ItemTurntable({
	slot,
	variantId,
	color,
	className,
}: {
	slot: string;
	variantId?: string;
	color?: string;
	className?: string;
}) {
	const mountRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		let disposed = false;
		let raf = 0;

		const px = mount.clientWidth || 112;
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setSize(px, px);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setClearColor(0x000000, 0);
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		mount.appendChild(renderer.domElement);
		scene.add(new THREE.HemisphereLight("#ffffff", "#c8cbd8", 0.9));
		const keyLight = new THREE.DirectionalLight("#fff4dc", 1.6);
		keyLight.position.set(3, 4, 3);
		scene.add(keyLight);
		const fillLight = new THREE.DirectionalLight("#a9c9ff", 0.55);
		fillLight.position.set(-3, 1, 2);
		scene.add(fillLight);

		(async () => {
			const gltf = await loadChar();
			if (disposed) return;
			const model = cloneSkinned(gltf.scene);
			// showcase tilt: the spin axis leans a touch toward the camera, so the
			// item presents its top as it turns (the tilt group stays fixed while
			// the inner pivot does the spinning)
			const tilt = new THREE.Group();
			tilt.rotation.set(0.14, 0, -0.16);
			const pivot = new THREE.Group();
			pivot.add(model);
			tilt.add(pivot);
			scene.add(tilt);
			let body: THREE.SkinnedMesh | null = null;
			const charMeshes: THREE.Mesh[] = [];
			model.traverse((c) => {
				if (c instanceof THREE.SkinnedMesh) {
					charMeshes.push(c);
					c.frustumCulled = false;
					if ((c.material as THREE.MeshStandardMaterial).map) body = c;
				}
			});
			if (!body) return;
			const cos = createCosmetics(body, turntableSettings(), null);
			await cos.equip(slot, variantId);
			if (disposed) return;
			if (color) cos.setColor(slot, color);
			for (const c of charMeshes) c.visible = false;

			// two frames so freshly-loaded textures apply, then center + frame
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			if (disposed) return;
			const box = new THREE.Box3();
			for (const m of cos.targets()) box.expandByObject(m);
			if (box.isEmpty()) return;
			const center = box.getCenter(new THREE.Vector3());
			model.position.sub(center); // spin about the item's own middle
			const span = box.getSize(new THREE.Vector3()).length() || 0.2;
			const dist = (span / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.2;
			camera.position.set(0, dist * 0.3, dist);
			camera.lookAt(0, 0, 0);

			let last = 0;
			const tick = (t: number) => {
				raf = requestAnimationFrame(tick);
				if (t - last < 33) return; // ~30fps is plenty for a slow spin
				last = t;
				pivot.rotation.y += 0.016;
				renderer.render(scene, camera);
			};
			raf = requestAnimationFrame(tick);
		})().catch(() => {
			// product art falls back to the static render elsewhere; stay blank here
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(raf);
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, [slot, variantId, color]);

	return <div ref={mountRef} className={className} />;
}
