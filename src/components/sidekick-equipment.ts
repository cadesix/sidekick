import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { makeItemMaterial, makeOutlineMaterial, type ItemLook } from "./sidekick-shading";
import type { SidekickSettings } from "./sidekick-settings";

// Modular equipment / cosmetics. Each slot ships as its own standalone GLB
// authored against the SAME rig as the character (see
// public/3d-assets/cosmetics-system.md), never baked into the character. At
// runtime we load a slot GLB and attach it two ways:
//   • "skinned"  (shirt, pants) → rebind its SkinnedMesh to the character's live
//     skeleton by matching bone names, so it deforms with the body.
//   • "bone:<Name>" (hat, shoes) → parent the mesh to the named character bone,
//     preserving its authored rest placement, so it rides that bone rigidly.
// A variant = an albedo texture (+ optional PBR params); swapping is just a
// material/map change, no reload. Everything is manifest-driven.

const MANIFEST_URL = "/cosmetics/manifest.json?v=1";

export type Variant = {
	id: string;
	name: string;
	tex?: string;
	color?: string;
	roughness?: number;
	metalness?: number;
	emissive?: string;
};
export type SlotDef = {
	model: string;
	attach: string; // "skinned" | "bone:<BoneName>"
	defaultColor?: string;
	scale?: number; // rigid-attach only: multiply the authored local scale
	offset?: [number, number, number]; // rigid-attach only: nudge in bone-local space
	variants: Variant[];
};
export type Manifest = Record<string, SlotDef>;

export type CosmeticsHandle = {
	ready: Promise<void>;
	slots: () => Manifest;
	equip: (slot: string, variantId?: string) => Promise<void>;
	setVariant: (slot: string, variantId: string) => void;
	unequip: (slot: string) => void;
	setVisible: (slot: string, on: boolean) => void;
	// rebuild all equipped materials for the current shading mode / settings
	refresh: (s: SidekickSettings, matcapTex: THREE.Texture | null) => void;
	// pointer hit-targets to fold into the poke/drag interaction
	targets: () => THREE.Object3D[];
	dispose: () => void;
};

type Equipped = {
	def: SlotDef;
	meshes: THREE.Mesh[]; // one for skinned/hat, possibly two for shoes
	outline: THREE.SkinnedMesh | null;
	variantId: string;
};

export function createCosmetics(
	bodyMesh: THREE.SkinnedMesh,
	settings: SidekickSettings,
	matcapTex: THREE.Texture | null,
): CosmeticsHandle {
	let manifest: Manifest = {};
	let lastS = settings;
	let lastMatcap = matcapTex;
	let disposed = false;
	const equipped = new Map<string, Equipped>();
	const gltfCache = new Map<string, Promise<THREE.Group>>();
	const texCache = new Map<string, THREE.Texture>();
	const loader = new GLTFLoader();
	const charBoneByName = new Map(bodyMesh.skeleton.bones.map((b) => [b.name, b]));

	const ready = fetch(MANIFEST_URL)
		.then((r) => r.json())
		.then((m: Manifest) => {
			manifest = m;
		})
		.catch((e) => console.error("[cosmetics] manifest load failed:", e));

	const loadGltf = (url: string): Promise<THREE.Group> => {
		let p = gltfCache.get(url);
		if (!p) {
			p = new Promise<THREE.Group>((resolve, reject) =>
				loader.load(url, (g) => resolve(g.scene), undefined, reject),
			);
			gltfCache.set(url, p);
		}
		return p;
	};

	// never rejects: a missing/failed texture resolves null so the variant just
	// falls back to its solid color (the manifest may reference textures the art
	// pipeline hasn't produced yet).
	const loadTex = (url: string): Promise<THREE.Texture | null> => {
		const cached = texCache.get(url);
		if (cached) return Promise.resolve(cached);
		return new Promise((resolve) =>
			new THREE.TextureLoader().load(
				url,
				(t) => {
					t.colorSpace = THREE.SRGBColorSpace;
					t.flipY = false; // glTF UV convention (matches the exported slot mesh)
					t.wrapS = t.wrapT = THREE.RepeatWrapping;
					texCache.set(url, t);
					resolve(t);
				},
				undefined,
				() => {
					console.warn(`[cosmetics] texture missing, using color: ${url}`);
					resolve(null);
				},
			),
		);
	};

	// resolve a variant's look (color falls back to slot default → shirtColor)
	const lookFor = (def: SlotDef, v: Variant, map: THREE.Texture | null): ItemLook => ({
		color: v.color ?? def.defaultColor ?? lastS.shirtColor,
		map,
		roughness: v.roughness,
		metalness: v.metalness,
		emissive: v.emissive,
	});

	const applyVariant = (slot: string) => {
		const eq = equipped.get(slot);
		if (!eq) return;
		const v = eq.def.variants.find((x) => x.id === eq.variantId) ?? eq.def.variants[0];
		const map = v.tex ? texCache.get(v.tex) ?? null : null;
		const look = lookFor(eq.def, v, map);
		for (const mesh of eq.meshes) {
			(mesh.material as THREE.Material).dispose();
			mesh.material = makeItemMaterial(lastS, look, lastMatcap);
		}
		if (eq.outline) {
			(eq.outline.material as THREE.Material).dispose();
			eq.outline.material = makeOutlineMaterial(lastS);
			eq.outline.visible = eq.meshes[0]?.visible !== false && lastS.outline;
		}
	};

	const attachSkinned = (scene: THREE.Group, def: SlotDef): Equipped => {
		let item: THREE.SkinnedMesh | null = null;
		scene.traverse((o) => {
			if ((o as THREE.SkinnedMesh).isSkinnedMesh) item = o as THREE.SkinnedMesh;
		});
		const shirt = item as unknown as THREE.SkinnedMesh;
		const geo = shirt.geometry as THREE.BufferGeometry;
		if (!geo.attributes.normal) geo.computeVertexNormals();
		// rebind the slot's skin to the CHARACTER's bones, matched by name
		const bones = shirt.skeleton.bones.map((b) => charBoneByName.get(b.name) ?? b);
		const skel = new THREE.Skeleton(bones, shirt.skeleton.boneInverses);
		shirt.frustumCulled = false;
		shirt.castShadow = true;
		bodyMesh.parent!.add(shirt);
		shirt.position.set(0, 0, 0);
		shirt.quaternion.identity();
		shirt.scale.setScalar(1);
		shirt.bind(skel, shirt.bindMatrix);
		// its own inverted-hull outline (rides ~1.7% outside the body so it hides
		// the body's outline across the torso)
		const outline = new THREE.SkinnedMesh(geo, makeOutlineMaterial(lastS));
		outline.bind(skel, shirt.bindMatrix);
		outline.frustumCulled = false;
		bodyMesh.parent!.add(outline);
		return { def, meshes: [shirt], outline, variantId: def.variants[0].id };
	};

	// Rigid: the slot is authored as a non-skinned mesh parented to a bone in an
	// IDENTICAL rig (e.g. the hat under "Head"), so its node transform is already
	// bone-local. We reparent it to the character's matching bone and copy that
	// authored local transform verbatim — the character's bone carries the
	// runtime normalization (scale/placement) via its parent chain, so the item
	// inherits it for free and then rides the bone.
	const attachRigid = (scene: THREE.Group, def: SlotDef, boneName: string): Equipped => {
		const meshes: THREE.Mesh[] = [];
		scene.traverse((o) => {
			if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) {
				meshes.push(o as THREE.Mesh);
			}
		});
		for (const mesh of meshes) {
			// prefer the bone the artist actually parented it under; fall back to the
			// manifest's bone. Shoes: a mesh named ...R... rides the right calf.
			const authored = mesh.parent?.name ? charBoneByName.get(mesh.parent.name) : undefined;
			let target = authored ?? charBoneByName.get(boneName);
			if (!target && boneName === "Calf") {
				const side = /(^|[^a-z])r([^a-z]|$)|right/i.test(mesh.name) ? "R" : "L";
				target = charBoneByName.get(`${side}_Calf`);
			}
			if (!target) continue;
			const pos = mesh.position.clone();
			const quat = mesh.quaternion.clone();
			const scl = mesh.scale.clone().multiplyScalar(def.scale ?? 1);
			if (def.offset) pos.add(new THREE.Vector3().fromArray(def.offset));
			target.add(mesh);
			mesh.position.copy(pos);
			mesh.quaternion.copy(quat);
			mesh.scale.copy(scl);
			mesh.frustumCulled = false;
			mesh.castShadow = true;
		}
		return { def, meshes, outline: null, variantId: def.variants[0].id };
	};

	return {
		ready,
		slots: () => manifest,
		equip: async (slot, variantId) => {
			await ready;
			if (disposed) return;
			const def = manifest[slot];
			if (!def) {
				console.warn(`[cosmetics] no such slot: ${slot}`);
				return;
			}
			const want = variantId ?? equipped.get(slot)?.variantId ?? def.variants[0].id;
			if (equipped.has(slot)) {
				(equipped.get(slot) as Equipped).meshes.forEach((m) => (m.visible = true));
				const v = def.variants.find((x) => x.id === want);
				if (v?.tex) await loadTex(v.tex);
				(equipped.get(slot) as Equipped).variantId = want;
				applyVariant(slot);
				return;
			}
			const scene = (await loadGltf(def.model)).clone(true);
			if (disposed) return;
			const eq =
				def.attach === "skinned"
					? attachSkinned(scene, def)
					: attachRigid(scene, def, def.attach.replace(/^bone:/, ""));
			eq.variantId = want;
			equipped.set(slot, eq);
			const v = def.variants.find((x) => x.id === want);
			if (v?.tex) await loadTex(v.tex);
			applyVariant(slot);
		},
		setVariant: (slot, variantId) => {
			const eq = equipped.get(slot);
			if (!eq) return;
			eq.variantId = variantId;
			const v = eq.def.variants.find((x) => x.id === variantId);
			if (v?.tex && !texCache.has(v.tex)) {
				loadTex(v.tex).then(() => applyVariant(slot));
			} else {
				applyVariant(slot);
			}
		},
		unequip: (slot) => {
			const eq = equipped.get(slot);
			if (!eq) return;
			for (const o of [...eq.meshes, eq.outline]) {
				if (!o) continue;
				o.parent?.remove(o);
				(o.material as THREE.Material).dispose();
			}
			eq.meshes[0]?.geometry.dispose();
			equipped.delete(slot);
		},
		setVisible: (slot, on) => {
			const eq = equipped.get(slot);
			if (!eq) return;
			eq.meshes.forEach((m) => (m.visible = on));
			if (eq.outline) eq.outline.visible = on && lastS.outline;
		},
		refresh: (s, m) => {
			lastS = s;
			lastMatcap = m;
			for (const slot of equipped.keys()) applyVariant(slot);
		},
		targets: () => [...equipped.values()].flatMap((eq) => eq.meshes),
		dispose: () => {
			disposed = true;
			for (const slot of [...equipped.keys()]) {
				const eq = equipped.get(slot)!;
				for (const o of [...eq.meshes, eq.outline]) {
					if (!o) continue;
					o.parent?.remove(o);
					(o.material as THREE.Material).dispose();
				}
				eq.meshes[0]?.geometry.dispose();
			}
			equipped.clear();
			texCache.forEach((t) => t.dispose());
			texCache.clear();
		},
	};
}
