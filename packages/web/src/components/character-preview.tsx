import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadChar } from "./item-turntable";
import { createCosmetics, type CosmeticsHandle } from "./sidekick-equipment";
import { loadSettings, type SidekickSettings } from "./sidekick-settings";
import { makeCharacterMaterials, makeOutlineMaterial, type TexSet } from "./sidekick-shading";
import {
	FACE_CELLS,
	createFaceController,
	loadFaceTexture,
	type FaceController,
} from "./sidekick-face";
import { loadWardrobe, WARDROBE_SLOTS } from "./sidekick-wardrobe";

// Small spinning full-body character for the Shop takeover — the live dressing
// mirror. Loads the rigged character once (module-cached), applies the saved
// wardrobe + skin, slowly rotates it, and re-reads the wardrobe on sync() so
// tapping an item in the shop shows up on him within a frame. Its own tiny
// WebGL view (~30fps while mounted), independent of the main home canvas.

export type CharacterPreviewHandle = { sync: () => void };

function previewSettings(): SidekickSettings {
	// neutral daylight tint, matching the product renders (evening warps colors)
	return { ...loadSettings(), timeOfDay: "day" };
}

export const CharacterPreview = forwardRef<CharacterPreviewHandle, { className?: string }>(function CharacterPreview(
	{ className },
	ref,
) {
	const mountRef = useRef<HTMLDivElement>(null);
	const cosRef = useRef<CosmeticsHandle | null>(null);
	const settingsRef = useRef<SidekickSettings>(previewSettings());
	const faceCtlRef = useRef<FaceController | null>(null);

	// re-apply the whole saved wardrobe (equip changed slots, unequip removed)
	const applyWardrobe = () => {
		const cos = cosRef.current;
		if (!cos) return;
		const w = loadWardrobe();
		for (const slot of WARDROBE_SLOTS) {
			const st = w[slot];
			if (st?.equipped) {
				cos.equip(slot, st.variantId).then(() => {
					if (st.color) cos.setColor(slot, st.color);
					else cos.setColor(slot, null);
				});
			} else {
				cos.unequip(slot);
			}
		}
	};
	useImperativeHandle(ref, () => ({ sync: applyWardrobe }), []);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		let disposed = false;
		let raf = 0;
		const s = settingsRef.current;

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 40);
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setClearColor(0x000000, 0);
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		mount.appendChild(renderer.domElement);
		const resize = () => {
			const w = mount.clientWidth || 1;
			const h = mount.clientHeight || 1;
			renderer.setSize(w, h);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(mount);

		scene.add(new THREE.HemisphereLight("#ffffff", "#c8cbd8", 0.9));
		const key = new THREE.DirectionalLight("#fff4dc", 1.6);
		key.position.set(3, 4, 3);
		scene.add(key);
		const fill = new THREE.DirectionalLight("#a9c9ff", 0.55);
		fill.position.set(-3, 1, 2);
		scene.add(fill);

		const pivot = new THREE.Group();
		scene.add(pivot);

		(async () => {
			const gltf = await loadChar();
			if (disposed) return;
			const model = cloneSkinned(gltf.scene);
			pivot.add(model);
			let bodyMesh: THREE.SkinnedMesh | null = null;
			let faceMesh: THREE.SkinnedMesh | null = null;
			let texSet: TexSet = { map: null, normalMap: null, vertexColors: false };
			model.traverse((c) => {
				if (!(c instanceof THREE.SkinnedMesh)) return;
				c.frustumCulled = false;
				const orig = c.material as THREE.MeshStandardMaterial;
				if (orig.map) {
					bodyMesh = c;
					texSet = { map: orig.map, normalMap: null, vertexColors: !!c.geometry.attributes.color };
				} else faceMesh = c;
			});
			if (!bodyMesh) return;

			// normalize: feet at y=0, one unit tall, then center for the spin
			const box = new THREE.Box3().setFromObject(model);
			const scale = 1 / (box.max.y - box.min.y);
			model.scale.setScalar(scale);
			const c2 = box.getCenter(new THREE.Vector3());
			model.position.set(-c2.x * scale, -box.min.y * scale, -c2.z * scale);

			// cel body/face materials + a happy face
			const faceTex = await new Promise<THREE.Texture | null>((r) => loadFaceTexture(r));
			if (disposed) return;
			if (faceTex) {
				const ctl = createFaceController(faceTex, s.faceZoom, s.faceHeight);
				ctl.set("neutral" in FACE_CELLS ? "neutral" : "neutral");
				faceCtlRef.current = ctl;
			}
			const mats = makeCharacterMaterials(s, texSet, null, faceTex);
			(bodyMesh as THREE.SkinnedMesh).material = mats.body;
			if (faceMesh) (faceMesh as THREE.SkinnedMesh).material = mats.face;
			if (s.outline) {
				const b = bodyMesh as THREE.SkinnedMesh;
				const outline = new THREE.SkinnedMesh(b.geometry, makeOutlineMaterial(s));
				outline.bind(b.skeleton, b.bindMatrix);
				outline.frustumCulled = false;
				b.parent!.add(outline);
			}

			const cos = createCosmetics(bodyMesh, s, null);
			cosRef.current = cos;
			applyWardrobe();

			// frame the standing body centered in the square view
			pivot.updateWorldMatrix(true, true);
			const fb = new THREE.Box3().setFromObject(model);
			const center = fb.getCenter(new THREE.Vector3());
			pivot.position.sub(center); // spin about the body's middle
			const span = Math.max(fb.getSize(new THREE.Vector3()).y, 0.5);
			const dist = (span / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.35;
			camera.position.set(0, 0.05, dist);
			camera.lookAt(0, 0, 0);

			let last = 0;
			const tick = (t: number) => {
				raf = requestAnimationFrame(tick);
				if (t - last < 33) return; // ~30fps
				last = t;
				pivot.rotation.y += 0.014;
				faceCtlRef.current?.update(t / 1000);
				renderer.render(scene, camera);
			};
			raf = requestAnimationFrame(tick);
		})().catch(() => {
			// preview just stays blank if the character can't load
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(raf);
			ro.disconnect();
			cosRef.current?.dispose();
			cosRef.current = null;
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, []);

	return <div ref={mountRef} className={className} />;
});
