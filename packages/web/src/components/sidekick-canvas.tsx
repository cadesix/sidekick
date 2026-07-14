import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadSettings } from "./sidekick-settings";
import {
	MODEL_URL,
	SUN_DIR,
	makeCharacterMaterials,
	makeEnvScene,
	makeItemMaterial,
	makeOutlineMaterial,
	loadMatcapTexture,
	type TexSet,
} from "./sidekick-shading";
import type { BoxTier } from "./sidekick-daily-box";
import { makeGrassEnvironment } from "./sidekick-grass";
import { makeSky, type TimeOfDay } from "./sidekick-scene";
import { makeLandscape } from "./sidekick-landscape";
import { createFaceController, loadFaceTexture, type FaceController } from "./sidekick-face";
import { createInteraction, POKE_FACE } from "./sidekick-interact";
import { createCosmetics, type CosmeticsHandle } from "./sidekick-equipment";
import {
	loadWardrobe,
	regionSiblings,
	saveWardrobe,
	WARDROBE_SLOTS,
	type CosmeticsControls,
	type Wardrobe,
	type WardrobeSlot,
} from "./sidekick-wardrobe";
import { BIOMES, type BiomeId, type EnvironmentId } from "./sidekick-biomes";

// Full 3D home-screen scene: sky gradient, domed lawn with wind-swept grass,
// and the rigged Sidekick idling in it (blades bend away from his feet).
// Material, lighting, exposure, and camera all come from the shared look-dev
// settings saved by the /sidekick-3d tweak panel.

const BONE_MAP = {
	head: "Head",
	waist: "Waist",
	spine: "Spine01",
	armL: "L_Upperarm",
	armR: "R_Upperarm",
	forearmL: "L_Forearm",
	forearmR: "R_Forearm",
	handL: "L_Hand",
	handR: "R_Hand",
	thighL: "L_Thigh",
	thighR: "R_Thigh",
	calfL: "L_Calf",
	calfR: "R_Calf",
} as const;
type BoneName = keyof typeof BONE_MAP;

// idle arm pose (drop/roll/bend) comes from the shared settings' Pose folder

// fallback framing when no camera has been saved from /sidekick-3d:
// level camera placed so the feet (world y=0) sit just below the fold —
// he stands on the lawn with his ankles tucked behind the goals sheet
const FALLBACK_CAM_POS: [number, number, number] = [0, 0.96, 2.6];
const FALLBACK_CAM_TARGET: [number, number, number] = [0, 0.96, 0];

// "holding phone" pose: right arm swung forward with a hard elbow bend so the
// hand — and the phone parented to R_Hand — comes up in front of the chest, plus
// a head pitch to look down at it. Blended in when `holdingPhone` is set.
// both hands come up in front to hold the phone (texting): mirrored L/R arms
// meeting at the centre, elbows bent, plus a head pitch to look down at it.
// Right paw folds the phone across the chest; the left paw comes in beside it so
// the two hands read as a two-handed hold near the centre. The L/R arms are NOT
// a clean mirror (the chibi rig's roll axis differs per side), so the numbers are
// tuned independently rather than sign-flipped.
// Both paws meet at the centre to cradle the phone (texting). The right paw folds
// the phone across the chest; the left upper arm is swung PAST vertical (big
// negative swingZ) so it crosses the body to the centre, where its forearm folds
// up beside the phone. The two arms are NOT sign-mirrors of each other — the
// chibi rig's forearm roll behaves differently per side, so each is tuned solo.
// authored in the /pose studio ("phone-hold-fixed"): both paws cupped together at
// the centre of the belly to cradle the phone, head tipped slightly down.
const PHONE_R = { swingX: -0.1, swingZ: 2.12, foreX: -0.47, foreZ: -0.53, twist: -1.06 };
const PHONE_L = { swingX: -1.41, swingZ: -1.56, foreX: -0.6, foreZ: -0.06, twist: 0.51 };
// slight 3/4 body turn; the head yaws slightly back so the face still reads to camera.
const PHONE_POSE = { headPitch: 0.19, headYaw: -0.13, bodyYaw: 0.55 };

// Optional camera override: a full-viewport host (e.g. /home4) can frame the
// character however it likes, ignoring the saved /sidekick-3d camera while
// still sharing the material/lighting/pose look.
export type CanvasFraming = {
	pos: [number, number, number];
	target: [number, number, number];
	fov?: number;
};

// Imperative controls for the /onboarding cinematic, populated via `handleRef`
// (same mutable-ref pattern as controlsRef): the jump-into-frame entrance, a
// camera shake, and a live body recolor. Hosts that don't pass handleRef are
// unaffected.
export type SidekickCanvasHandle = {
	jumpIn: (opts?: { duration?: number }) => void;
	shake: (opts?: { amp?: number; duration?: number; mode?: "impact" | "build" }) => void;
	setColors: (body: string, shadow?: string) => void;
	// daily box: play the open animation (shake → grow → gone). The DOM layer
	// (daily-box.tsx) times its flash/confetti to the same beats.
	popDailyBox: () => void;
};

// Studio (Shop) backdrop: a soft warm vertical sweep (light top → warm floor) so
// the character pops out of the meadow into a clean "photo studio". Mapped onto an
// inward sphere so it can crossfade over the sky as the Shop opens.
function makeStudioBackground(): THREE.Texture {
	const c = document.createElement("canvas");
	c.width = 8;
	c.height = 512;
	const x = c.getContext("2d")!;
	const g = x.createLinearGradient(0, 0, 0, 512);
	g.addColorStop(0, "#f6f1e9");
	g.addColorStop(0.55, "#ece2d3");
	g.addColorStop(1, "#d6ccbb");
	x.fillStyle = g;
	x.fillRect(0, 0, 8, 512);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

// soft elliptical contact shadow under the feet so he's grounded on the studio floor
function makeContactShadow(): THREE.Mesh {
	const c = document.createElement("canvas");
	c.width = c.height = 128;
	const x = c.getContext("2d")!;
	const g = x.createRadialGradient(64, 64, 3, 64, 64, 62);
	g.addColorStop(0, "rgba(30,24,16,0.42)");
	g.addColorStop(0.7, "rgba(30,24,16,0.12)");
	g.addColorStop(1, "rgba(30,24,16,0)");
	x.fillStyle = g;
	x.fillRect(0, 0, 128, 128);
	const tex = new THREE.CanvasTexture(c);
	const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.95), mat);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = 0.006;
	mesh.renderOrder = -1;
	return mesh;
}

export function SidekickCanvas({
	className,
	framing,
	landscape,
	holdingPhone,
	raised,
	studio,
	environment,
	controlsRef,
	overheadRef,
	groundRef,
	dailyBox,
	paused,
	hidden,
	timeOfDay,
	cameraDrag = true,
	handleRef,
}: {
	className?: string;
	framing?: CanvasFraming;
	landscape?: boolean;
	holdingPhone?: boolean;
	// onboarding: park the character below the frame until jumpIn() (entrance)
	hidden?: boolean;
	// onboarding: force a time-of-day (e.g. "evening") over the saved setting
	timeOfDay?: TimeOfDay;
	// when false, hold the camera at its framing (no orbit drag) — onboarding
	cameraDrag?: boolean;
	// onboarding imperative handle (jumpIn / shake / setColors)
	handleRef?: MutableRefObject<SidekickCanvasHandle | null>;
	// lift the whole character up out of the grass so the legs/shoes are visible
	// (used by the Shop so you can see pants & shoes swaps)
	raised?: boolean;
	// Shop "studio": hide the meadow and show the character on a clean backdrop
	studio?: boolean;
	// which world the character stands in: home meadow (default) or a travel biome
	environment?: EnvironmentId;
	// populated once cosmetics are ready so a host (e.g. the Shop) can dress the
	// live character; cleared on unmount
	controlsRef?: MutableRefObject<CosmeticsControls | null>;
	// an overlay element (e.g. the Bond badge) the canvas pins over the
	// character's head every frame via 3D→screen projection
	overheadRef?: MutableRefObject<HTMLDivElement | null>;
	// an overlay element (e.g. the daily box tap target + burst FX) pinned to a
	// spot on the ground beside the character — same projection trick
	groundRef?: MutableRefObject<HTMLDivElement | null>;
	// when set, the 3D loot chest (props/lootbox-v1.glb) stands at the ground
	// anchor, tinted for the given tier; null/undefined hides it
	dailyBox?: BoxTier | null;
	// skip all per-frame work while something fully covers the canvas (e.g. the
	// near-full-screen Shop) — the RAF keeps ticking so resume is instant
	paused?: boolean;
}) {
	const mountRef = useRef<HTMLDivElement>(null);
	const raisedRef = useRef(raised);
	raisedRef.current = raised;
	const studioRef = useRef(studio);
	studioRef.current = studio;
	const pausedRef = useRef(paused);
	pausedRef.current = paused;
	const envRef = useRef<EnvironmentId>(environment ?? "meadow");
	envRef.current = environment ?? "meadow";
	// kept current so the render loop can ease the camera toward a new framing
	// (e.g. /home4 zooms out when the chat drawer opens) without re-mounting
	const framingRef = useRef(framing);
	framingRef.current = framing;
	// when true, the character raises its right hand + looks down at the phone
	const phoneRef = useRef(holdingPhone);
	phoneRef.current = holdingPhone;
	// daily-box tier (or null) — read by the render loop like the flags above
	const dailyBoxRef = useRef(dailyBox);
	dailyBoxRef.current = dailyBox;

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const s = loadSettings();
		// StrictMode (dev) mounts→cleans→remounts; the async GLB load below isn't
		// abortable, so guard its callback — a cleaned-up mount must never build
		// cosmetics or publish controls, or controlsRef ends up on a dead canvas.
		let cancelled = false;

		const sc = s.scenes[timeOfDay ?? s.timeOfDay];
		const scene = new THREE.Scene();
		scene.background = makeSky(sc);
		// the vista wants light, far haze so distant mountains recede; the close
		// meadow keeps its tighter fog
		scene.fog = landscape ? new THREE.Fog(sc.fog, 70, 230) : new THREE.Fog(sc.fog, sc.fogNear, sc.fogFar);
		const grass = makeGrassEnvironment();
		grass.setColors(sc.grassHill, sc.grassBase, sc.grassTip, sc.rock);
		grass.relayout(s.grassHeight, s.grassClumping);
		scene.add(grass.group);
		if (landscape) scene.add(makeLandscape());

		// Shop "studio" look, crossfaded in by `studio`: an inward backdrop sphere
		// + contact shadow fade IN while the meadow fades OUT. Built once; the loop
		// eases the blend.
		const meadowFog = scene.fog;
		const studioTex = makeStudioBackground();
		const studioSphere = new THREE.Mesh(
			new THREE.SphereGeometry(60, 32, 20),
			new THREE.MeshBasicMaterial({ map: studioTex, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }),
		);
		studioSphere.renderOrder = -2; // draw behind the character
		studioSphere.visible = false;
		scene.add(studioSphere);
		const contactShadow = makeContactShadow();
		contactShadow.visible = false;
		scene.add(contactShadow);
		// every meadow material, so we can fade the whole meadow out together.
		// Clouds get their own list: each cloud is a pile of overlapping opaque
		// lobes sharing one material, so at opacity o the stack still covers
		// ~1-(1-o)^lobes and would visibly outlast the single-surface grass/hill.
		// baseAlphaTest remembers cutout thresholds (daisies) so the cutoff can
		// scale with the fade instead of popping the mesh out at a fixed 0.5;
		// baseOpacity/transparent/depthWrite restore authored state (e.g. the
		// volcano smoke ships at opacity 0.7) when the fade unwinds. Cloud
		// materials fade on a squared curve: each cloud is a pile of overlapping
		// lobes sharing one material, so at opacity o the stack still covers
		// ~1-(1-o)^lobes and would visibly outlast single-surface neighbors.
		type FadeMat = {
			m: THREE.Material;
			baseOpacity: number;
			baseTransparent: boolean;
			baseDepthWrite: boolean;
			baseAlphaTest: number;
			squared: boolean;
		};
		// one registry per environment group (meadow now, each biome on first
		// fade there), so shop crossfades dim EVERY world on one clock
		const fadeCache = new Map<THREE.Object3D, FadeMat[]>();
		const fadeMatsFor = (root: THREE.Object3D): FadeMat[] => {
			let list = fadeCache.get(root);
			if (!list) {
				list = [];
				const seen = new Set<THREE.Material>();
				const cloudMats = new Set<THREE.Material>();
				if (root === grass.group)
					grass.clouds.traverse((o) => {
						const m = (o as THREE.Mesh).material;
						if (m) for (const mm of Array.isArray(m) ? m : [m]) cloudMats.add(mm);
					});
				root.traverse((o) => {
					const m = (o as THREE.Mesh).material;
					if (!m) return;
					for (const mm of Array.isArray(m) ? m : [m]) {
						if (seen.has(mm)) continue;
						seen.add(mm);
						list!.push({
							m: mm,
							baseOpacity: mm.opacity,
							baseTransparent: mm.transparent,
							baseDepthWrite: mm.depthWrite,
							baseAlphaTest: mm.alphaTest,
							squared: cloudMats.has(mm),
						});
					}
				});
				fadeCache.set(root, list);
			}
			return list;
		};

		const camera = new THREE.PerspectiveCamera(framing?.fov ?? s.fov, mount.clientWidth / mount.clientHeight, 0.1, 260);
		const camBasePos = new THREE.Vector3().fromArray(framing?.pos ?? s.camPos ?? FALLBACK_CAM_POS);
		const camBaseTarget = new THREE.Vector3().fromArray(framing?.target ?? s.camTarget ?? FALLBACK_CAM_TARGET);
		camera.position.copy(camBasePos);
		camera.lookAt(camBaseTarget);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = sc.exposure;
		mount.appendChild(renderer.domElement);

		// same warm-panel IBL as the viewer so the vinyl reads identically
		const pmrem = new THREE.PMREMGenerator(renderer);
		scene.environment = pmrem.fromScene(makeEnvScene(), 0.04).texture;
		scene.environmentIntensity = s.envIntensity;

		// lighting rig from the active time-of-day scene preset
		const hemi = new THREE.HemisphereLight(new THREE.Color(sc.hemiSky), new THREE.Color(sc.hemiGround), sc.hemiIntensity);
		scene.add(hemi);
		const key = new THREE.DirectionalLight(new THREE.Color(sc.keyColor), sc.keyIntensity);
		key.position.copy(SUN_DIR).multiplyScalar(12);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.radius = 6;
		scene.add(key);
		const fill = new THREE.DirectionalLight(new THREE.Color(sc.fillColor), sc.fillIntensity);
		fill.position.set(-4, 1.5, 3);
		scene.add(fill);
		const rim = new THREE.DirectionalLight(new THREE.Color(sc.rimColor), sc.rimIntensity);
		rim.position.copy(SUN_DIR).multiplyScalar(8).setY(2.2);
		scene.add(rim);

		// the lawn receives his cast shadow; shadowOpacity drives its strength
		key.shadow.intensity = s.shadowOpacity * 3;
		// crisper, wider shadows for the cinematic biome cast shadows
		key.shadow.mapSize.set(2048, 2048);
		key.shadow.camera.left = -12;
		key.shadow.camera.right = 12;
		key.shadow.camera.top = 12;
		key.shadow.camera.bottom = -12;
		key.shadow.camera.near = 0.5;
		key.shadow.camera.far = 48;
		key.shadow.bias = -0.0004;
		key.shadow.camera.updateProjectionMatrix();
		// keep the meadow key direction so we can restore it when leaving a biome
		const meadowKeyPos = key.position.clone();
		const meadowRimPos = rim.position.clone();
		const tmpDir = new THREE.Vector3();

		// ---- travel environments (snow / desert biomes) ----------------------
		// The `environment` prop swaps the whole place: ground, sky, fog, light rig,
		// exposure. The meadow is the default; biomes are built lazily and cached.
		// The active ground (`activeGround`) and `envFog` feed the studio crossfade
		// below so the Shop backdrop still layers over whatever world you're in.
		const meadowSky = scene.background;
		let activeGround: THREE.Object3D = grass.group;
		let envFog = meadowFog;
		type BiomeBuilt = { group: THREE.Group; sky: THREE.Texture; fog: THREE.Fog };
		const biomeCache = new Map<BiomeId, BiomeBuilt>();
		const getBiome = (id: BiomeId): BiomeBuilt => {
			let bc = biomeCache.get(id);
			if (!bc) {
				const def = BIOMES[id];
				const group = def.build();
				group.visible = false;
				scene.add(group);
				const sky = makeSky(def.preset);
				const fog = new THREE.Fog(def.preset.fog, def.preset.fogNear, def.preset.fogFar);
				bc = { group, sky, fog };
				biomeCache.set(id, bc);
			}
			return bc;
		};
		// look = the light/exposure bundle to apply (meadow uses `sc`; biomes their preset)
		const applyEnv = (id: EnvironmentId) => {
			activeGround.visible = false;
			let look: typeof sc | (typeof BIOMES)[BiomeId]["preset"];
			if (id === "meadow") {
				look = sc;
				scene.background = meadowSky;
				envFog = meadowFog;
				activeGround = grass.group;
			} else {
				const bc = getBiome(id);
				look = BIOMES[id].preset;
				scene.background = bc.sky;
				envFog = bc.fog;
				activeGround = bc.group;
			}
			key.color.set(look.keyColor);
			key.intensity = look.keyIntensity;
			fill.color.set(look.fillColor);
			fill.intensity = look.fillIntensity;
			rim.color.set(look.rimColor);
			rim.intensity = look.rimIntensity;
			hemi.color.set(look.hemiSky);
			hemi.groundColor.set(look.hemiGround);
			hemi.intensity = look.hemiIntensity;
			renderer.toneMappingExposure = look.exposure;
			grass.setClouds(look.keyColor, look.fog);
			// cinematic per-biome lighting: a dramatic raking key from `keyDir`, a
			// colored backlight rim behind the character, and real cast shadows. The
			// meadow keeps its saved rig.
			if (id === "meadow") {
				key.position.copy(meadowKeyPos);
				rim.position.copy(meadowRimPos);
				key.shadow.intensity = s.shadowOpacity * 3;
			} else {
				const p = BIOMES[id].preset;
				key.position.copy(tmpDir.fromArray(p.keyDir).normalize()).multiplyScalar(16);
				rim.position.copy(tmpDir.fromArray(p.rimDir).normalize()).multiplyScalar(12);
				key.shadow.intensity = p.shadow;
			}
			activeGround.visible = true;
		};

		// character materials come from the shared shading module (same modes
		// and params as /sidekick-3d); built once the GLB textures are known
		let bodyMesh: THREE.SkinnedMesh | null = null;
		let faceMesh: THREE.SkinnedMesh | null = null;
		let texSet: TexSet = { map: null, normalMap: null, vertexColors: false };
		let matcapTex: THREE.Texture | null = null;
		let faceTex: THREE.Texture | null = null;
		let faceCtl: FaceController | null = null;
		let cos: CosmeticsHandle | null = null;
		loadMatcapTexture((t) => {
			matcapTex = t;
			applyShading();
		});
		loadFaceTexture((t) => {
			if (t) {
				faceTex = t;
				faceCtl = createFaceController(t, s.faceZoom, s.faceHeight);
			}
			applyShading();
		});
		// ---- daily loot chest: a world prop at the ground anchor (daily-box.tsx
		// owns the DOM tap target + burst FX; home5 orchestrates the flow) ----
		const DAILY_BOX_POS = new THREE.Vector3(0.55, 0, 0.55);
		const DAILY_BOX_SCALE = 0.34;
		// per-tier tints keyed by the GLB's authored material names
		const BOX_PALETTES: Record<BoxTier, Record<string, string>> = {
			base: { Chest_Body: "#FFD65C", Chest_Trim: "#FF5B4D", Chest_Emblem: "#FFF2DC" },
			silver: { Chest_Body: "#DCE6F5", Chest_Trim: "#7C5CFF", Chest_Emblem: "#FFFFFF" },
			gold: { Chest_Body: "#FFC93D", Chest_Trim: "#7C5CFF", Chest_Emblem: "#FFF6D8" },
		};
		const boxGroup = new THREE.Group();
		boxGroup.position.copy(DAILY_BOX_POS);
		boxGroup.rotation.y = -0.3; // angle the latch a touch toward the camera
		boxGroup.visible = false;
		scene.add(boxGroup);
		let boxMeshes: THREE.Mesh[] = [];
		let boxTint: BoxTier | null = null;
		let boxLoading = false;
		let boxSpawn = -1; // clock time the chest appeared (scale-in spring)
		let boxPop = -1; // clock time popDailyBox() fired
		const tintBox = (tier: BoxTier) => {
			const pal = BOX_PALETTES[tier];
			for (const m of boxMeshes) {
				(m.material as THREE.Material).dispose();
				m.material = makeItemMaterial(
					s,
					{ color: pal[m.userData.matName as string] ?? pal.Chest_Body, map: null },
					matcapTex,
				);
			}
			boxTint = tier;
		};
		const loadBox = () => {
			boxLoading = true;
			new GLTFLoader().load("/props/lootbox-v1.glb", (g) => {
				if (cancelled) return;
				const meshes: THREE.Mesh[] = [];
				g.scene.traverse((o) => {
					const mesh = o as THREE.Mesh;
					if (mesh.isMesh) meshes.push(mesh);
				});
				for (const mesh of meshes) {
					mesh.userData.matName = (mesh.material as THREE.Material).name;
					mesh.castShadow = true;
					// Same amber inverted-hull ink as the character, as a child so it
					// inherits the mesh transform. The shader's displacement assumes the
					// character's 0.2-unit-raw → 5× world scaling; the chest renders at
					// DAILY_BOX_SCALE, so widen proportionally to keep the same ink weight.
					const ink = new THREE.Mesh(
						mesh.geometry,
						makeOutlineMaterial({ ...s, outlineWidth: (s.outlineWidth * 5) / DAILY_BOX_SCALE }),
					);
					mesh.add(ink);
				}
				boxMeshes = meshes;
				boxGroup.add(g.scene);
				boxSpawn = clock.getElapsedTime();
			});
		};
		const applyShading = () => {
			if (boxTint) tintBox(boxTint); // rebuild chest materials for the new mode
			if (!bodyMesh) return;
			const { body, face } = makeCharacterMaterials(s, texSet, matcapTex, faceTex);
			bodyMesh.material = body;
			if (faceMesh) faceMesh.material = face;
			cos?.refresh(s, matcapTex);
		};

		// pull carries the interactive body-drag lean/offset/squash (anchored at
		// the feet); rig inside it keeps the model-facing yaw and clip motion
		const pull = new THREE.Group();
		scene.add(pull);
		const rig = new THREE.Group();
		rig.rotation.y = -Math.PI / 2; // model faces +X raw
		pull.add(rig);

		const bones = {} as Record<BoneName, THREE.Bone>;
		const rest = {} as Record<BoneName, THREE.Quaternion>;
		let ready = false;

		// onboarding entrance + shake state (no-ops unless jumpIn/shake are called)
		const HIDDEN_Y = -3;
		let entranceY = hidden ? HIDDEN_Y : 0;
		let jump: { start: number; dur: number } | null = null;
		let landed = false;
		let shake: { start: number; dur: number; amp: number; mode: "impact" | "build" } | null = null;

		new GLTFLoader().load(
			MODEL_URL,
			(gltf) => {
				if (cancelled) return; // this mount was already torn down (StrictMode)
				const model = gltf.scene;
				model.traverse((child) => {
					if (child instanceof THREE.SkinnedMesh) {
						const geo = child.geometry as THREE.BufferGeometry;
						if (!geo.attributes.normal) geo.computeVertexNormals();
						const orig = child.material as THREE.MeshStandardMaterial;
						if (orig.map) {
							texSet = {
								map: orig.map,
								// stale bake (pre-rig-fix topology) paints scratchy creases
								normalMap: null,
								vertexColors: !!geo.attributes.color,
							};
							bodyMesh = child;
							child.castShadow = true;
						} else {
							// untextured "FaceSprite" plane — gets a flat-color variant of
							// the active material until the face sprite sheet is wired up
							faceMesh = child;
						}
						child.frustumCulled = false;
					}
				});
				if (bodyMesh && s.outline) {
					// inverted-hull outline, mirroring the /sidekick-3d setting
					const b = bodyMesh as THREE.SkinnedMesh;
					const outline = new THREE.SkinnedMesh(b.geometry, makeOutlineMaterial(s));
					outline.bind(b.skeleton, b.bindMatrix);
					outline.position.copy(b.position);
					outline.quaternion.copy(b.quaternion);
					outline.scale.copy(b.scale);
					outline.frustumCulled = false;
					b.parent!.add(outline);
				}
				applyShading();
				const box = new THREE.Box3().setFromObject(model);
				const sc = 1 / (box.max.y - box.min.y);
				model.scale.setScalar(sc);
				const center = box.getCenter(new THREE.Vector3());
				model.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
				rig.add(model);
				for (const [ours, theirs] of Object.entries(BONE_MAP)) {
					const bone = model.getObjectByName(theirs);
					if (!(bone instanceof THREE.Bone)) return;
					bones[ours as BoneName] = bone;
					rest[ours as BoneName] = bone.quaternion.clone();
				}
				// modular equipment: manifest-driven cosmetics bound to this rig,
				// dressed from the saved wardrobe (the Shop drives it live)
				if (bodyMesh) {
					cos = createCosmetics(bodyMesh, s, matcapTex);
					const wardrobe: Wardrobe = loadWardrobe();
					for (const slot of WARDROBE_SLOTS) {
						const st = wardrobe[slot];
						if (!st.equipped) continue;
						cos.equip(slot, st.variantId).then(() => {
							if (st.color) cos?.setColor(slot, st.color);
						});
					}
					// preload the phone into the hand, hidden until holdingPhone
					cos.equip("phone").then(() => cos?.setVisible("phone", false));

					// hand imperative dressing controls to React (Shop UI)
					if (controlsRef) {
						// one item per body region: dressing a slot strips its siblings
						// (hoodie replaces shirt, crown replaces beanie, …)
						const clearRegion = (slot: WardrobeSlot) => {
							for (const sib of regionSiblings(slot)) {
								if (wardrobe[sib].equipped) {
									wardrobe[sib] = { ...wardrobe[sib], equipped: false };
									cos?.unequip(sib);
								}
							}
						};
						controlsRef.current = {
							manifest: () => cos!.slots(),
							getState: () => structuredClone(wardrobe),
							equipVariant: (slot, variantId) => {
								clearRegion(slot);
								wardrobe[slot] = { equipped: true, variantId, color: undefined };
								saveWardrobe(wardrobe);
								cos?.equip(slot, variantId);
							},
							setColor: (slot, color) => {
								clearRegion(slot);
								const wasOff = !wardrobe[slot].equipped;
								const variantId = wardrobe[slot].variantId ?? cos!.slots()[slot]?.variants[0]?.id;
								wardrobe[slot] = { equipped: true, variantId, color };
								saveWardrobe(wardrobe);
								if (wasOff) cos?.equip(slot, variantId).then(() => cos?.setColor(slot, color));
								else cos?.setColor(slot, color);
							},
							remove: (slot) => {
								wardrobe[slot] = { ...wardrobe[slot], equipped: false };
								saveWardrobe(wardrobe);
								cos?.unequip(slot);
							},
						};
					}
				}
				ready = true;
			},
			undefined,
			(err) => console.error("[sidekick-canvas] load failed:", err),
		);

		// poke/drag layer: owns the canvas pointer events (hover-look included)
		const interact = createInteraction({
			dom: renderer.domElement,
			camera,
			targets: () =>
				[bodyMesh, faceMesh, ...(cos?.targets() ?? [])].filter(Boolean) as THREE.Object3D[],
			bone: (n) => bones[n],
			cameraDrag,
			onPoke: (part) => {
				const expr = POKE_FACE[part];
				if (expr) faceCtl?.pulse(expr, 1.6);
			},
		});

		const e = new THREE.Euler();
		const qWorld = new THREE.Quaternion();
		const qParent = new THREE.Quaternion();
		const qLocal = new THREE.Quaternion();
		const setBoneQ = (name: BoneName, q: THREE.Quaternion) => {
			const bone = bones[name];
			bone.parent!.getWorldQuaternion(qParent);
			qLocal.copy(qParent).invert().multiply(q).multiply(qParent);
			bone.quaternion.copy(qLocal).multiply(rest[name]);
		};
		const setBone = (name: BoneName, ex: number, ey: number, ez: number) => {
			qWorld.setFromEuler(e.set(ex, ey, ez));
			setBoneQ(name, qWorld);
		};
		// arm with palm roll about its own swung axis, split across arm+forearm
		// so the shoulder doesn't shear (mirrors /sidekick-3d's setArm; all the
		// pose numbers come from the shared settings' Pose folder)
		const qSwing = new THREE.Quaternion();
		const qRoll = new THREE.Quaternion();
		const qArm = new THREE.Quaternion();
		const armAxis = new THREE.Vector3();
		const setArm = (arm: BoneName, forearm: BoneName, side: 1 | -1, swingX: number, swingZ: number, roll: number, foreX: number, foreZ = 0) => {
			qSwing.setFromEuler(e.set(swingX, 0, swingZ));
			armAxis.set(side, 0, 0).applyQuaternion(qSwing);
			qRoll.setFromAxisAngle(armAxis, roll * s.poseRollSplit);
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(arm, qArm);
			qSwing.setFromEuler(e.set(foreX, 0, foreZ));
			qRoll.setFromAxisAngle(armAxis, roll * (1 - s.poseRollSplit));
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(forearm, qArm);
		};

		let raf = 0;
		const clock = new THREE.Clock();
		const camSph = new THREE.Spherical();
		const camOff = new THREE.Vector3();
		const overheadV = new THREE.Vector3();
		const groundV = new THREE.Vector3();
		const wantPos = new THREE.Vector3();
		const wantTgt = new THREE.Vector3();
		let phoneBlend = 0; // 0 idle → 1 holding the phone up
		let phoneShown = false;
		let liftY = 0; // eased height the character floats above the meadow (Shop)
		let studioT = 0; // eased meadow→studio blend (0 meadow, 1 studio)
		let curEnv: EnvironmentId = "meadow";
		applyEnv(curEnv);
		const lerp = THREE.MathUtils.lerp;

		// onboarding imperative controls, consumed via handleRef
		if (handleRef) {
			handleRef.current = {
				jumpIn: (o) => {
					jump = { start: clock.getElapsedTime(), dur: (o?.duration ?? 800) / 1000 };
					landed = false;
					faceCtl?.pulse("excited", 1);
				},
				shake: (o) => {
					shake = {
						start: clock.getElapsedTime(),
						dur: (o?.duration ?? 500) / 1000,
						amp: o?.amp ?? 0.1,
						mode: o?.mode ?? "impact",
					};
				},
				setColors: (body, shadow) => {
					s.celBodyColor = body;
					if (shadow) s.celShadowColor = shadow;
					applyShading();
				},
				popDailyBox: () => {
					if (boxPop < 0) boxPop = clock.getElapsedTime();
				},
			};
		}

		const animate = () => {
			raf = requestAnimationFrame(animate);
			if (pausedRef.current) return;
			const now = clock.getElapsedTime();
			const fr = interact.update(now);
			// swap the whole world when `environment` changes (map travel). Instant —
			// the map's full-screen reveal masks it; the studio crossfade layers on top.
			if (envRef.current !== curEnv) {
				curEnv = envRef.current;
				applyEnv(curEnv);
			}
			// crossfade the current world out / studio backdrop in when the Shop opens
			const targetT = studioRef.current ? 1 : 0;
			studioT += (targetT - studioT) * 0.3;
			if (Math.abs(targetT - studioT) < 0.003) studioT = targetT;
			const inStudio = studioT > 0.001;
			studioSphere.visible = inStudio;
			(studioSphere.material as THREE.MeshBasicMaterial).opacity = studioT;
			contactShadow.visible = inStudio;
			(contactShadow.material as THREE.MeshBasicMaterial).opacity = studioT;
			activeGround.visible = studioT < 0.999;
			// the meadow's grass fades material-by-material for a soft studio wipe;
			// biome grounds just hide under the (fully opaque) studio sphere
			// dim every material of the ACTIVE world (meadow or biome) on the same
			// clock, so trees, clouds, rocks and ground reach zero together instead
			// of popping one by one as the studio sphere saturates over them
			if (studioT < 0.999) {
				const o = 1 - studioT;
				for (const f of fadeMatsFor(activeGround)) {
					if (inStudio) {
						f.m.transparent = true;
						f.m.depthWrite = false; // while fading, don't occlude the studio sphere
						f.m.opacity = f.baseOpacity * (f.squared ? o * o : o);
						// scale cutout thresholds (daisies) with the fade so the
						// silhouette stays constant instead of popping at a fixed 0.5
						if (f.baseAlphaTest) f.m.alphaTest = f.baseAlphaTest * o;
					} else {
						// fade fully unwound — restore the authored material state
						f.m.transparent = f.baseTransparent;
						f.m.depthWrite = f.baseDepthWrite;
						f.m.opacity = f.baseOpacity;
						if (f.baseAlphaTest) f.m.alphaTest = f.baseAlphaTest;
					}
				}
			}
			scene.fog = inStudio ? null : envFog;
			// ease the "raised out of the grass" lift used by the Shop
			liftY += ((raisedRef.current ? 0.62 : 0) - liftY) * 0.1;
			// jump-into-frame entrance: launch from HIDDEN_Y with an eased rise + a
			// short arc overshoot; fire the impact shake at touchdown
			if (jump) {
				const p = THREE.MathUtils.clamp((now - jump.start) / jump.dur, 0, 1);
				const rise = 1 - Math.pow(1 - p, 3);
				const hop = Math.sin(p * Math.PI) * 0.3;
				entranceY = THREE.MathUtils.lerp(HIDDEN_Y, 0, rise) + hop;
				if (p >= 0.9 && !landed) {
					landed = true;
					shake = { start: now, dur: 0.55, amp: 0.2, mode: "impact" };
				}
				if (p >= 1) {
					entranceY = 0;
					jump = null;
				}
			}
			// body-drag lean/offset/squash (springs home to rest on release); the
			// entrance offset rides on the same group so he lands into the scene
			pull.position.set(fr.bodyX, liftY + entranceY, fr.bodyZ);
			pull.rotation.set(fr.tiltX, 0, fr.tiltZ);
			pull.scale.set(1 / Math.sqrt(fr.squash), fr.squash, 1 / Math.sqrt(fr.squash));
			if (ready) {
				const breath = 1 + Math.sin(now * 2.2) * 0.012;
				// jump-entrance envelopes: touchdown squash, arms reach up, knees tuck.
				// All 0 when not jumping, so idle/phone pose is byte-identical to before.
				let land = 1;
				let armUp = 0;
				let tuck = 0;
				if (jump) {
					const p = THREE.MathUtils.clamp((now - jump.start) / jump.dur, 0, 1);
					if (p > 0.75) land = 1 - Math.sin(((p - 0.75) / 0.25) * Math.PI) * 0.14;
					armUp = 1 - THREE.MathUtils.smoothstep(p, 0.2, 0.85);
					tuck = 1 - THREE.MathUtils.smoothstep(p, 0.1, 0.7);
				}
				const ys = breath * land;
				rig.scale.set(1 / Math.sqrt(ys), ys, 1 / Math.sqrt(ys));
				const sway = Math.sin(now * 2.2) * 0.04;
				// ease the "holding phone" pose in/out and toggle the prop's visibility
				phoneBlend += ((phoneRef.current ? 1 : 0) - phoneBlend) * 0.09;
				const wantShown = phoneBlend > 0.02;
				if (wantShown !== phoneShown) {
					phoneShown = wantShown;
					cos?.setVisible("phone", wantShown);
				}
				const pb = phoneBlend;
				// swing the whole body off-square BEFORE posing the arms — setBoneQ maps
				// each arm's world-space delta through the parent's current world
				// quaternion, so the body yaw must already be in place or the arms
				// resolve to a different local pose than the /pose studio authored.
				pull.rotation.y = PHONE_POSE.bodyYaw * pb;
				// arm targets: idle → two-handed phone-hold (pb) → jump-up reach (armUp)
				let swXL = lerp(s.poseArmForward + fr.armL.fwd, PHONE_L.swingX, pb);
				let swZL = lerp(-s.poseArmDown + sway + fr.armL.swing, PHONE_L.swingZ, pb);
				let twL = lerp(s.poseArmTwist, PHONE_L.twist, pb);
				let foXL = lerp(s.poseForeBend, PHONE_L.foreX, pb);
				const foZL = lerp(0, PHONE_L.foreZ, pb);
				let swXR = lerp(s.poseArmForward + fr.armR.fwd, PHONE_R.swingX, pb);
				let swZR = lerp(s.poseArmDown - sway + fr.armR.swing, PHONE_R.swingZ, pb);
				let twR = lerp(-s.poseArmTwist, PHONE_R.twist, pb);
				let foXR = lerp(s.poseForeBend, PHONE_R.foreX, pb);
				const foZR = lerp(0, PHONE_R.foreZ, pb);
				if (armUp > 0) {
					swZL = lerp(swZL, 0.95, armUp);
					twL = lerp(twL, 0, armUp);
					foXL = lerp(foXL, 0, armUp);
					swZR = lerp(swZR, -0.95, armUp);
					twR = lerp(twR, 0, armUp);
					foXR = lerp(foXR, 0, armUp);
				}
				setArm("armL", "forearmL", 1, swXL, swZL, twL, foXL, foZL);
				setArm("armR", "forearmR", -1, swXR, swZR, twR, foXR, foZR);
				bones.armL.scale.setScalar(1 + fr.armL.stretch);
				bones.armR.scale.setScalar(1 + fr.armR.stretch);
				setBone("head", fr.headPitch + PHONE_POSE.headPitch * pb, fr.headYaw + PHONE_POSE.headYaw * pb, 0);
				// body-drag bend splits across waist + spine (arc toward the grab
				// point); the trailing leg lifts and its knee curls when off balance
				setBone("waist", fr.bendX * 0.5, 0, fr.bendZ * 0.5);
				setBone("spine", fr.bendX * 0.5, 0, fr.bendZ * 0.5);
				// knees tuck up while airborne, releasing to a stand on landing
				setBone("thighL", 0, 0, fr.legL.lift + tuck * 0.55);
				setBone("calfL", fr.legL.curl - tuck * 0.9, 0, 0);
				setBone("thighR", 0, 0, fr.legR.lift - tuck * 0.55);
				setBone("calfR", fr.legR.curl - tuck * 0.9, 0, 0);
			}
			// ease the base framing toward the current prop (smooth zoom on chat open)
			const wf = framingRef.current;
			if (wf) {
				camBasePos.lerp(wantPos.fromArray(wf.pos), 0.07);
				camBaseTarget.lerp(wantTgt.fromArray(wf.target), 0.07);
				const wfFov = wf.fov ?? camera.fov;
				if (Math.abs(wfFov - camera.fov) > 0.02) {
					camera.fov += (wfFov - camera.fov) * 0.07;
					camera.updateProjectionMatrix();
				}
			}
			// springy orbit offset around the saved framing; snaps back on release
			camOff.copy(camBasePos).sub(camBaseTarget);
			camSph.setFromVector3(camOff);
			camSph.theta += fr.camYaw;
			camSph.phi = THREE.MathUtils.clamp(camSph.phi + fr.camPitch, 0.3, Math.PI - 0.3);
			camera.position.setFromSpherical(camSph).add(camBaseTarget);
			camera.lookAt(camBaseTarget);
			// onboarding camera shake: "impact" spikes then decays, "build" ramps up
			if (shake) {
				const sp = (now - shake.start) / shake.dur;
				if (sp >= 1) {
					shake = null;
				} else {
					const env = shake.mode === "build" ? sp * sp : (1 - sp) * (1 - sp);
					const a = shake.amp * env;
					camera.position.x += Math.sin(now * 92) * a;
					camera.position.y += Math.cos(now * 71) * a;
					camera.position.z += Math.sin(now * 64) * a * 0.8;
					camera.rotation.z += Math.sin(now * 83) * a * 0.7;
					camera.rotation.x += Math.cos(now * 101) * a * 0.35;
				}
			}
			grass.update(now, pull.position);
			faceCtl?.update(now);
			// daily loot chest: lazy-load on first request, then spawn spring →
			// idle bob → (on popDailyBox) excited shake → grow → gone
			const wantBox = dailyBoxRef.current;
			if (wantBox && !boxMeshes.length && !boxLoading) loadBox();
			if (boxMeshes.length) {
				if (wantBox && boxTint !== wantBox) tintBox(wantBox);
				if (!wantBox && boxPop >= 0) boxPop = -1; // reset for the next day
				const popT = boxPop >= 0 ? now - boxPop : -1;
				boxGroup.visible = !!wantBox && !inStudio && (popT < 0 || popT < 0.82);
				if (boxGroup.visible) {
					// scale-in spring on spawn (slight overshoot), then gentle bob
					const ts = Math.min(1, (now - boxSpawn) / 0.55);
					const spring = 1 - Math.pow(1 - ts, 3) * Math.cos(ts * 9);
					let scale = DAILY_BOX_SCALE * spring;
					boxGroup.position.y = DAILY_BOX_POS.y + (0.5 + 0.5 * Math.sin(now * 2.1)) * 0.022;
					boxGroup.rotation.z = 0;
					if (popT >= 0) {
						if (popT < 0.45) {
							// excited wiggle, growing in amplitude
							boxGroup.rotation.z = Math.sin(popT * 42) * 0.12 * (0.4 + popT * 1.6);
						} else {
							// burst: swell up while the DOM flash/confetti covers the vanish
							scale = DAILY_BOX_SCALE * (1 + ((popT - 0.45) / 0.37) * 0.9);
						}
					}
					boxGroup.scale.setScalar(Math.max(0.0001, scale));
				}
			}
			// pin the overhead overlay (Bond badge) above the head bone: world pos
			// → NDC → CSS px. Follows jumps, drags, and the shop lift for free.
			const overhead = overheadRef?.current;
			if (overhead) {
				if (ready) {
					bones.head.getWorldPosition(overheadV);
					overheadV.y += 0.55;
					overheadV.project(camera);
					const sx = (overheadV.x * 0.5 + 0.5) * mount.clientWidth;
					const sy = (-overheadV.y * 0.5 + 0.5) * mount.clientHeight;
					overhead.style.transform = `translate(-50%, -100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
					overhead.style.visibility = overheadV.z < 1 ? "visible" : "hidden";
				} else {
					overhead.style.visibility = "hidden";
				}
			}
			// pin the ground overlay (daily box) to a fixed spot on the lawn beside
			// the character (bottom-center anchored so it "stands" on the grass)
			const ground = groundRef?.current;
			if (ground) {
				if (ready && !studioRef.current) {
					groundV.copy(DAILY_BOX_POS);
					groundV.project(camera);
					const gx = (groundV.x * 0.5 + 0.5) * mount.clientWidth;
					const gy = (-groundV.y * 0.5 + 0.5) * mount.clientHeight;
					ground.style.transform = `translate(-50%, -100%) translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`;
					ground.style.visibility = groundV.z < 1 ? "visible" : "hidden";
				} else {
					ground.style.visibility = "hidden";
				}
			}
			renderer.render(scene, camera);
		};
		animate();

		const onResize = () => {
			camera.aspect = mount.clientWidth / mount.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(mount.clientWidth, mount.clientHeight);
		};
		window.addEventListener("resize", onResize);
		// also follow the MOUNT's own size — hosts animate it (e.g. the onboarding
		// chat shrinks the scene into a FaceTime-style PiP), and the draw buffer
		// should shrink with it (fill-rate drops with the pixels)
		const ro = new ResizeObserver(onResize);
		ro.observe(mount);

		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			ro.disconnect();
			if (controlsRef) controlsRef.current = null;
			if (handleRef) handleRef.current = null;
			studioTex.dispose();
			studioSphere.geometry.dispose();
			(studioSphere.material as THREE.Material).dispose();
			contactShadow.geometry.dispose();
			(contactShadow.material as THREE.Material).dispose();
			for (const bc of biomeCache.values()) {
				bc.sky.dispose();
				bc.group.traverse((o) => {
					const m = o as THREE.Mesh;
					if (m.geometry) m.geometry.dispose();
					const mat = m.material;
					if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
					else if (mat) (mat as THREE.Material).dispose();
				});
			}
			cos?.dispose();
			interact.dispose();
			pmrem.dispose();
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, []);

	return <div ref={mountRef} className={className} aria-hidden="true" />;
}
