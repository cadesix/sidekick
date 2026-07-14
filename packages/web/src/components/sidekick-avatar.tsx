import { useEffect, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadChar } from "./item-turntable";
import { createCosmetics } from "./sidekick-equipment";
import { createFaceController, loadFaceTexture } from "./sidekick-face";
import { makeCharacterMaterials, type TexSet } from "./sidekick-shading";
import { loadSettings } from "./sidekick-settings";
import { WARDROBE_EVENT, loadWardrobe, type WardrobeSlot } from "./sidekick-wardrobe";

// The avatar as a live snapshot: a one-shot offscreen render of the character's
// HEAD — face, smile, and whatever head-region cosmetics are currently worn
// (hat family + glasses) — cached as a data URL and regenerated whenever the
// wardrobe changes. <SidekickAvatar> is the drop-in <img> that every chat
// bubble / notification / icon slot uses; it falls back to the static pfp art
// until the first render lands. Cost: one 128² render at load and one per
// outfit change — no persistent GL context.

// bump the suffix whenever framing/composition changes — stale cached
// snapshots regenerate on next load
const AVATAR_KEY = "sidekick_avatar_v5";
const AVATAR_EVENT = "sidekick:avatar";
const SIZE = 128;
const HEAD_SLOTS: WardrobeSlot[] = ["hat", "beanie", "bucket", "wizard", "crown", "glasses"];

let current: string | null = null;
try {
	current = localStorage.getItem(AVATAR_KEY);
} catch {
	// storage blocked — stay on the static fallback
}

let inFlight: Promise<void> | null = null;
let listening = false;

async function generate(): Promise<void> {
	const s = { ...loadSettings(), timeOfDay: "day" as const }; // neutral tint, like product shots
	const gltf = await loadChar();
	const model = cloneSkinned(gltf.scene);

	const scene = new THREE.Scene();
	scene.add(model);
	scene.add(new THREE.HemisphereLight("#ffffff", "#c8cbd8", 0.9));
	const key = new THREE.DirectionalLight("#fff4dc", 1.5);
	key.position.set(3, 4, 3);
	scene.add(key);

	// normalize like the canvas: feet at y=0, one unit tall
	const box = new THREE.Box3().setFromObject(model);
	const scale = 1 / (box.max.y - box.min.y);
	model.scale.setScalar(scale);
	const center = box.getCenter(new THREE.Vector3());
	model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

	// body/face materials in the app's real shading, with the face smiling
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
		} else {
			faceMesh = c;
		}
	});
	if (!bodyMesh) return;
	// carve the body down to just the head: collapse every vertex that isn't
	// majority-skinned to the Head bone onto the neck point INSIDE the head
	// shell. Boundary triangles taper into the interior where the head hides
	// them. Purely geometric — immune to the custom cel shader ignoring
	// renderer clipping planes (which is why the v3 clip-plane approach failed).
	{
		const body = bodyMesh as THREE.SkinnedMesh;
		const geo = (body.geometry as THREE.BufferGeometry).clone(); // don't mutate the shared GLB geometry
		body.geometry = geo;
		const headIdx = body.skeleton.bones.findIndex((b) => b.name === "Head");
		if (headIdx >= 0) {
			const bind = new THREE.Matrix4().copy(body.skeleton.boneInverses[headIdx]).invert();
			const neck = new THREE.Vector3().setFromMatrixPosition(bind);
			const pos = geo.attributes.position as THREE.BufferAttribute;
			const sIdx = geo.attributes.skinIndex as THREE.BufferAttribute;
			const sW = geo.attributes.skinWeight as THREE.BufferAttribute;
			for (let i = 0; i < pos.count; i++) {
				let headWeight = 0;
				for (let k = 0; k < 4; k++) if (sIdx.getComponent(i, k) === headIdx) headWeight += sW.getComponent(i, k);
				if (headWeight < 0.5) pos.setXYZ(i, neck.x, neck.y, neck.z);
			}
			pos.needsUpdate = true;
			geo.computeBoundingSphere();
		}
	}
	const faceTex = await new Promise<THREE.Texture | null>((r) => loadFaceTexture(r));
	if (faceTex) {
		const ctl = createFaceController(faceTex, s.faceZoom, s.faceHeight);
		// "neutral" is the open-eyed smile; "happy" is the closed-eye ^_^ blink
		ctl.set("neutral");
		ctl.setBlinking(false);
		ctl.update(0);
	}
	const mats = makeCharacterMaterials(s, texSet, null, faceTex);
	(bodyMesh as THREE.SkinnedMesh).material = mats.body;
	if (faceMesh) (faceMesh as THREE.SkinnedMesh).material = mats.face;

	// worn head-region cosmetics
	const wardrobe = loadWardrobe();
	const cos = createCosmetics(bodyMesh, s, null);
	for (const slot of HEAD_SLOTS) {
		const st = wardrobe[slot];
		if (!st?.equipped) continue;
		await cos.equip(slot, st.variantId);
		if (st.color) cos.setColor(slot, st.color);
	}

	// frame the ACTUAL remaining geometry (post-collapse the body's bounds ARE
	// the head), so wide ears, crown spikes, and tall hats never crop
	model.updateWorldMatrix(true, true);
	const body = bodyMesh as THREE.SkinnedMesh;
	const bodyGeo = body.geometry as THREE.BufferGeometry;
	bodyGeo.computeBoundingBox();
	const frame = bodyGeo.boundingBox!.clone().applyMatrix4(body.matrixWorld);
	for (const m of cos.targets()) frame.expandByObject(m);
	frame.expandByScalar(0.015);
	const fCenter = frame.getCenter(new THREE.Vector3());
	const span = frame.getSize(new THREE.Vector3()).length();

	const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
	// model faces +X raw — dead-on head shot
	const dir = new THREE.Vector3(1, 0.05, 0).normalize();
	const dist = (span / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.08;
	camera.position.copy(fCenter).addScaledVector(dir, dist);
	camera.lookAt(fCenter);

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
	renderer.setSize(SIZE, SIZE);
	renderer.setPixelRatio(1);
	renderer.setClearColor(0x000000, 0);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	// two renders so async-compiled materials/textures settle
	renderer.render(scene, camera);
	await new Promise((r) => requestAnimationFrame(r));
	renderer.render(scene, camera);
	const url = renderer.domElement.toDataURL("image/png");
	renderer.dispose();
	cos.dispose();

	current = url;
	try {
		localStorage.setItem(AVATAR_KEY, url);
	} catch {
		// too big for quota? keep it in memory for this session
	}
	window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: url }));
}

function ensureAvatar(): void {
	const kick = () => {
		inFlight = (inFlight ?? Promise.resolve())
			.then(() => generate())
			.catch(() => {
				inFlight = null;
			});
	};
	if (!listening) {
		listening = true;
		window.addEventListener(WARDROBE_EVENT, kick);
	}
	if (!current && !inFlight) kick();
}

// Drop-in avatar <img>: live head snapshot, static pfp until it exists.
export function SidekickAvatar({ className, alt = "" }: { className?: string; alt?: string }) {
	const [src, setSrc] = useState<string | null>(current);
	useEffect(() => {
		ensureAvatar();
		const on = (e: Event) => setSrc((e as CustomEvent<string>).detail);
		window.addEventListener(AVATAR_EVENT, on);
		return () => window.removeEventListener(AVATAR_EVENT, on);
	}, []);
	return (
		<img
			src={src ?? "/sidekick-pfp.webp"}
			alt={alt}
			aria-hidden={alt === ""}
			draggable={false}
			className={className}
		/>
	);
}
