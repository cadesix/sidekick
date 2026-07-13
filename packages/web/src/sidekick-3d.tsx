import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { TiltShiftShader, fovFromFocalLength, focalLengthFromFov } from "./components/sidekick-post";
import GUI from "lil-gui";
import {
	DEFAULT_SETTINGS,
	SETTINGS_KEY,
	loadSettings,
	saveSettings,
	type SidekickSettings,
} from "./components/sidekick-settings";
import {
	MODEL_URL,
	SUN_DIR,
	makeCharacterMaterials,
	makeEnvScene,
	makeOutlineMaterial,
	makePhysicalMaterial,
	loadMatcapTexture,
	type TexSet,
} from "./components/sidekick-shading";
import { makeGrassEnvironment } from "./components/sidekick-grass";
import { makeSky, TIMES } from "./components/sidekick-scene";
import { createInteraction, POKE_FACE } from "./components/sidekick-interact";
import { createCosmetics, type CosmeticsHandle } from "./components/sidekick-equipment";
import {
	FACE_EXPRESSIONS,
	createFaceController,
	loadFaceTexture,
	type FaceController,
	type FaceExpression,
} from "./components/sidekick-face";

// Rigged 3D Sidekick viewer. The GLB (public/sidekick-rigged.glb, from the
// char-pipeline) ships a full humanoid skeleton and baked color texture, so
// this page only retargets our procedural clips onto its bones and applies
// the brand vinyl material/lighting. No runtime rigging or face painting.

// Our clip logic → GLB bone names (Tripo/AccuRig-style humanoid rig)
// Checked-in look-dev states (config-presets/README.md) — recovered saved
// states from earlier dev-server origins. Any *.json dropped in that folder
// appears in the panel's Config presets picker.
const CONFIG_PRESETS = Object.fromEntries(
	Object.entries(
		import.meta.glob<Partial<SidekickSettings>>("./config-presets/*.json", { eager: true, import: "default" }),
	).map(([path, cfg]) => [path.split("/").pop()!.replace(/\.json$/, ""), cfg]),
);

const BONE_MAP = {
	waist: "Waist",
	spine: "Spine01",
	head: "Head",
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

// The bind pose is a T-pose. The idle arm drop/roll/bend all live in settings
// (poseArm*) and are tunable live from the GUI's Pose folder; this constant is
// only the reference amplitude the canned clips (dance) swing relative to.
// (Screen-left arm = R_Upperarm; +Z world rotation lowers it, -Z raises it.)
const ARM_DOWN = 1.15;

function param(name: string, fallback: number): number {
	const v = new URLSearchParams(window.location.search).get(name);
	return v !== null && !Number.isNaN(Number(v)) ? Number(v) : fallback;
}

type ClipName = "idle" | "wave" | "jump" | "cheer" | "dance";
const CLIP_DURATION: Record<ClipName, number> = {
	idle: Infinity,
	wave: 2.2,
	jump: 1.0,
	cheer: 2.4,
	dance: 3.2,
};

export default function Sidekick3D() {
	const mountRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState("loading mesh…");
	const playRef = useRef<(c: ClipName) => void>(() => {});

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;

		// persisted look-dev state, shared with /home3
		const settings = Object.assign(loadSettings(), {
			copySettings: () => {},
			resetSettings: () => {},
			resetCamera: () => {},
			saveConfig: () => {},
			downloadConfig: () => {},
			loadConfig: () => {},
			showSkeleton: false,
		});

		const scene = new THREE.Scene();
		// real 3D lawn: the active time-of-day scene preset drives sky + grass
		const sc0 = settings.scenes[settings.timeOfDay];
		scene.background = makeSky(sc0);
		scene.fog = new THREE.Fog(sc0.fog, sc0.fogNear, sc0.fogFar);
		const grass = makeGrassEnvironment();
		grass.setColors(sc0.grassHill, sc0.grassBase, sc0.grassTip, sc0.rock);
		grass.relayout(settings.grassHeight, settings.grassClumping);
		scene.add(grass.group);

		const DEFAULT_CAM_POS: [number, number, number] = [0, 0.75, 2.6];
		const DEFAULT_CAM_TARGET: [number, number, number] = [0, 0.45, 0];
		const camera = new THREE.PerspectiveCamera(settings.fov, mount.clientWidth / mount.clientHeight, 0.1, 260);
		camera.position.fromArray(settings.camPos ?? DEFAULT_CAM_POS);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = sc0.exposure;
		mount.appendChild(renderer.domElement);

		// warm sunset IBL from the procedural env scene
		const pmrem = new THREE.PMREMGenerator(renderer);
		scene.environment = pmrem.fromScene(makeEnvScene(), 0.04).texture;
		scene.environmentIntensity = settings.envIntensity;

		// post chain: render → depth-of-field → tilt-shift → bloom → output
		const composer = new EffectComposer(renderer);
		composer.addPass(new RenderPass(scene, camera));
		// depth-based DoF (aperture in the GUI is ×1e-4)
		const bokeh = new BokehPass(scene, camera, {
			focus: settings.dofFocus,
			aperture: settings.dofAperture * 1e-4,
			maxblur: settings.dofMaxBlur,
		});
		bokeh.enabled = settings.dofEnabled;
		composer.addPass(bokeh);
		// screen-space tilt-shift (miniature look)
		const tilt = new ShaderPass(TiltShiftShader);
		tilt.enabled = settings.tiltEnabled;
		tilt.uniforms.uFocusY.value = settings.tiltFocusY;
		tilt.uniforms.uBand.value = settings.tiltBand;
		tilt.uniforms.uBlur.value = settings.tiltBlur;
		tilt.uniforms.uResolution.value.set(mount.clientWidth, mount.clientHeight);
		composer.addPass(tilt);
		const bloom = new UnrealBloomPass(
			new THREE.Vector2(mount.clientWidth, mount.clientHeight),
			settings.bloomStrength, settings.bloomRadius, settings.bloomThreshold,
		);
		bloom.enabled = settings.bloomEnabled;
		composer.addPass(bloom);
		composer.addPass(new OutputPass());

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.target.fromArray(settings.camTarget ?? DEFAULT_CAM_TARGET);
		controls.enableDamping = true;
		controls.autoRotate = settings.autoRotate || param("spin", 0) !== 0;
		controls.minDistance = 1.2;
		controls.maxDistance = 12;

		// lighting rig from the active time-of-day scene preset
		const hemi = new THREE.HemisphereLight(new THREE.Color(sc0.hemiSky), new THREE.Color(sc0.hemiGround), sc0.hemiIntensity);
		scene.add(hemi);
		const key = new THREE.DirectionalLight(new THREE.Color(sc0.keyColor), sc0.keyIntensity);
		key.position.copy(SUN_DIR).multiplyScalar(12);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.radius = 6;
		scene.add(key);
		const fill = new THREE.DirectionalLight(new THREE.Color(sc0.fillColor), sc0.fillIntensity);
		fill.position.set(-4, 1.5, 3);
		scene.add(fill);
		const rim = new THREE.DirectionalLight(new THREE.Color(sc0.rimColor), sc0.rimIntensity);
		rim.position.copy(SUN_DIR).multiplyScalar(8).setY(2.2);
		scene.add(rim);

		// the hill receives the real cast shadow; shadowOpacity drives its strength
		key.shadow.intensity = settings.shadowOpacity * 3;

		// ---- shading modes ----
		// materials are rebuilt through the shared factory whenever a Shading
		// control settles; `vinyl` (physical) stays a stable reference so the
		// Material folder's live tweaks keep working
		let bodyMesh: THREE.SkinnedMesh | null = null;
		let faceMesh: THREE.SkinnedMesh | null = null;
		let outlineMesh: THREE.SkinnedMesh | null = null;
		let cos: CosmeticsHandle | null = null;
		let buildEquipGui: ((c: CosmeticsHandle) => void) | null = null;
		let texSet: TexSet = { map: null, normalMap: null, vertexColors: false };
		let matcapTex: THREE.Texture | null = null;
		let faceTex: THREE.Texture | null = null;
		let faceCtl: FaceController | null = null;
		// built eagerly so the Material GUI folder has a stable target; its maps
		// are filled in by rebuildShading() once the GLB is loaded
		const vinyl = makePhysicalMaterial(settings, { map: null, normalMap: null, vertexColors: false });
		loadMatcapTexture((t) => {
			matcapTex = t;
			rebuildShading();
		});
		loadFaceTexture((t) => {
			if (t) {
				faceTex = t;
				faceCtl = createFaceController(t, settings.faceZoom, settings.faceHeight);
			}
			rebuildShading();
		});
		const rebuildShading = () => {
			if (!bodyMesh) return;
			const prevBody = bodyMesh.material as THREE.Material;
			const prevFace = faceMesh?.material as THREE.Material | undefined;
			const mats = makeCharacterMaterials(settings, texSet, matcapTex, faceTex);
			if (settings.shading === "physical") {
				if (vinyl.map !== texSet.map) {
					vinyl.map = texSet.map;
					vinyl.normalMap = texSet.normalMap;
					vinyl.vertexColors = texSet.vertexColors;
					vinyl.needsUpdate = true;
				}
				bodyMesh.material = vinyl;
				mats.body.dispose();
			} else {
				bodyMesh.material = mats.body;
			}
			if (faceMesh) faceMesh.material = mats.face;
			if (prevBody !== vinyl && prevBody !== bodyMesh.material) prevBody.dispose();
			if (prevFace && faceMesh && prevFace !== faceMesh.material) prevFace.dispose();
			if (outlineMesh) {
				(outlineMesh.material as THREE.Material).dispose();
				outlineMesh.material = makeOutlineMaterial(settings);
				outlineMesh.visible = settings.outline;
			}
			cos?.refresh(settings, matcapTex);
		};

		// pull carries the interactive body-drag lean/offset/squash (anchored at
		// the feet); rig inside it keeps the model-facing yaw and clip motion
		const pull = new THREE.Group();
		scene.add(pull);
		const rig = new THREE.Group();
		pull.add(rig);
		rig.rotation.y = param("yaw", -Math.PI / 2); // model faces +X raw

		const bones = {} as Record<BoneName, THREE.Bone>;
		const rest = {} as Record<BoneName, THREE.Quaternion>;
		let skeletonHelper: THREE.SkeletonHelper | null = null;
		let ready = false;

		new GLTFLoader().load(
			MODEL_URL,
			(gltf) => {
				const model = gltf.scene;
				model.traverse((child) => {
					if (child instanceof THREE.SkinnedMesh) {
						const geo = child.geometry as THREE.BufferGeometry;
						if (!geo.attributes.normal) geo.computeVertexNormals();
						const orig = child.material as THREE.MeshStandardMaterial;
						if (orig.map) {
							texSet = {
								map: orig.map,
								// baked normal map is stale (baked against the pre-rig-fix
								// topology) and paints scratchy creases — off unless
								// ?normalmap=1 for A/B after a re-bake
								normalMap: param("normalmap", 0) ? orig.normalMap ?? null : null,
								vertexColors: !!geo.attributes.color,
							};
							bodyMesh = child;
							child.castShadow = true;
						} else {
							// untextured "FaceSprite" plane — gets a flat-color variant of
							// the active material until the face sprite sheet is wired up
							// (hiding it leaves a hole in the head)
							faceMesh = child;
						}
						child.frustumCulled = false;
					}
				});
				if (bodyMesh) {
					// inverted-hull outline: shares geometry + skeleton with the body
					const b = bodyMesh as THREE.SkinnedMesh;
					outlineMesh = new THREE.SkinnedMesh(b.geometry, makeOutlineMaterial(settings));
					outlineMesh.bind(b.skeleton, b.bindMatrix);
					outlineMesh.position.copy(b.position);
					outlineMesh.quaternion.copy(b.quaternion);
					outlineMesh.scale.copy(b.scale);
					outlineMesh.frustumCulled = false;
					outlineMesh.visible = settings.outline;
					b.parent!.add(outlineMesh);
				}
				rebuildShading();

				// normalize: feet on the ground, 1 unit tall, centered
				const box = new THREE.Box3().setFromObject(model);
				const height = box.max.y - box.min.y;
				const s = 1 / height;
				model.scale.setScalar(s);
				const center = box.getCenter(new THREE.Vector3());
				model.position.set(-center.x * s, -box.min.y * s, -center.z * s);
				rig.add(model);

				for (const [ours, theirs] of Object.entries(BONE_MAP)) {
					const bone = model.getObjectByName(theirs);
					if (!(bone instanceof THREE.Bone)) {
						setStatus(`bone not found in GLB: ${theirs}`);
						return;
					}
					bones[ours as BoneName] = bone;
					rest[ours as BoneName] = bone.quaternion.clone();
				}

				skeletonHelper = new THREE.SkeletonHelper(model);
				skeletonHelper.visible = false;
				scene.add(skeletonHelper);

				// modular equipment: manifest-driven cosmetics bound to this rig
				if (bodyMesh) {
					cos = createCosmetics(bodyMesh, settings, matcapTex);
					const c = cos;
					if (settings.shirtEnabled) c.equip("shirt");
					c.ready.then(() => buildEquipGui?.(c));
					if (import.meta.env.DEV) (window as unknown as { __cos: CosmeticsHandle }).__cos = c;
				}
				if (import.meta.env.DEV) {
					(window as unknown as { __dbg: unknown }).__dbg = () => ({
						shading: settings.shading,
						bodyMat: bodyMesh?.material && (bodyMesh.material as THREE.Material).type,
					});
				}

				ready = true;
				setStatus("");
			},
			undefined,
			(err) => {
				console.error("[sidekick-3d] load failed:", (err as Error)?.stack ?? err);
				setStatus(`failed to load mesh: ${String(err)}`);
			},
		);

		// ---- animation ----
		// poke/drag layer: taps make him look/react, dragging a hand or his body
		// pulls him around on springs. Camera drag stays with OrbitControls here
		// (this is the editor), so orbit just pauses while dragging the character.
		const interact = createInteraction({
			dom: renderer.domElement,
			camera,
			targets: () =>
				[bodyMesh, faceMesh, ...(cos?.targets() ?? [])].filter(Boolean) as THREE.Object3D[],
			bone: (n) => bones[n],
			cameraDrag: false,
			onPoke: (part) => {
				const expr = POKE_FACE[part];
				if (expr) faceCtl?.pulse(expr, 1.6);
			},
			onDragChange: (dragging) => {
				controls.enabled = !dragging;
			},
		});

		let clip: ClipName = "idle";
		let clipStart = 0;
		const clock = new THREE.Clock();
		const CLIP_FACE: Record<ClipName, FaceExpression> = {
			idle: "neutral",
			wave: "happy",
			jump: "excited",
			cheer: "cheer",
			dance: "happy",
		};
		playRef.current = (c: ClipName) => {
			clip = c;
			clipStart = clock.getElapsedTime();
			if (c !== "idle") faceCtl?.pulse(CLIP_FACE[c], CLIP_DURATION[c]);
		};

		// Apply a WORLD-space rotation delta on top of a bone's rest pose.
		// Blender rig bones have arbitrary local frames, so world-space deltas
		// keep the clip math readable (z = swing in view plane, y = yaw, x = pitch).
		const e = new THREE.Euler();
		const qWorld = new THREE.Quaternion();
		const qParent = new THREE.Quaternion();
		const qLocal = new THREE.Quaternion();
		const setBone = (name: BoneName, ex: number, ey: number, ez: number, order: THREE.EulerOrder = "XYZ") => {
			qWorld.setFromEuler(e.set(ex, ey, ez, order));
			setBoneQ(name, qWorld);
		};
		const setBoneQ = (name: BoneName, q: THREE.Quaternion) => {
			const bone = bones[name];
			bone.parent!.getWorldQuaternion(qParent);
			qLocal.copy(qParent).invert().multiply(q).multiply(qParent);
			bone.quaternion.copy(qLocal).multiply(rest[name]);
		};
		// Arm posing with a palm roll about the arm's own (swung) axis. The roll
		// is split half/half between upper arm and forearm so it doesn't shear
		// the chubby shoulder. side: +1 = armL (extends +X world), -1 = armR.
		const qSwing = new THREE.Quaternion();
		const qRoll = new THREE.Quaternion();
		const qArm = new THREE.Quaternion();
		const armAxis = new THREE.Vector3();
		const setArm = (
			arm: BoneName,
			forearm: BoneName,
			side: 1 | -1,
			swing: { x: number; z: number; roll: number },
			fore: { x: number; z: number },
		) => {
			const split = settings.poseRollSplit;
			qSwing.setFromEuler(e.set(swing.x, 0, swing.z));
			armAxis.set(side, 0, 0).applyQuaternion(qSwing);
			qRoll.setFromAxisAngle(armAxis, swing.roll * split);
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(arm, qArm);
			// forearm: remaining share of the roll + its own bend
			qSwing.setFromEuler(e.set(fore.x, 0, fore.z));
			qRoll.setFromAxisAngle(armAxis, swing.roll * (1 - split));
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(forearm, qArm);
		};
		// ease-in/out envelope so one-shot clips blend from/to idle
		const env = (t: number, dur: number) =>
			THREE.MathUtils.clamp(t / 0.25, 0, 1) * THREE.MathUtils.clamp((dur - t) / 0.3, 0, 1);

		let raf = 0;
		const grassPos = new THREE.Vector3();
		const animate = () => {
			raf = requestAnimationFrame(animate);
			const now = clock.getElapsedTime();
			const fr = interact.update(now);
			// body-drag lean/offset/squash (springs home to rest on release)
			pull.position.set(fr.bodyX, 0, fr.bodyZ);
			pull.rotation.set(fr.tiltX, 0, fr.tiltZ);
			pull.scale.set(1 / Math.sqrt(fr.squash), fr.squash, 1 / Math.sqrt(fr.squash));
			if (ready && param("anim", 1) !== 0) {
				const t = now - clipStart;
				if (t > CLIP_DURATION[clip]) clip = "idle";
				const lerp = THREE.MathUtils.lerp;

				// relaxed idle pose (arms dropped from the T-pose bind, elbows
				// softly bent, hands a touch forward); clips blend OVER this so
				// transitions never pass through the raw T-pose
				const breath = 1 + Math.sin(now * 2.2) * 0.012;
				rig.scale.set(1 / Math.sqrt(breath), breath, 1 / Math.sqrt(breath));
				rig.position.y = 0;
				const sway = Math.sin(now * 2.2) * 0.04;
				let armLz = -settings.poseArmDown + sway + fr.armL.swing;
				let armRz = settings.poseArmDown - sway + fr.armR.swing;
				let armLx = settings.poseArmForward + fr.armL.fwd;
				let armRx = settings.poseArmForward + fr.armR.fwd;
				const twist = settings.poseArmTwist;
				let armLy = twist;
				let armRy = -twist;
				let foreLx = settings.poseForeBend;
				let foreRx = settings.poseForeBend;
				let foreLz = 0;
				let foreRz = 0;
				let headX = fr.headPitch;
				let headY = fr.headYaw;
				let headZ = 0;
				let waistY = 0;
				let spineY = 0;
				let spineZ = 0;

				if (clip === "wave") {
					// screen-left arm swings up beside the head, hand waves at the elbow
					const a = env(t, CLIP_DURATION.wave);
					armRz = lerp(armRz, -0.6, a);
					armRy = lerp(armRy, 0, a); // untwist as the arm rises
					foreRx = lerp(foreRx, 0, a);
					foreRz = lerp(foreRz, -0.45 - 0.45 * Math.sin(t * 11), a);
					headZ += a * 0.12;
					headX = lerp(headX, 0, a * 0.5);
					headY = lerp(headY, 0, a * 0.5);
				} else if (clip === "jump") {
					// arms fly up with the hop, land back at the sides
					const p = THREE.MathUtils.clamp((t - 0.12) / 0.65, 0, 1);
					const hop = Math.sin(p * Math.PI);
					rig.position.y = 0.24 * hop;
					const squash = t < 0.12 ? 1 - (t / 0.12) * 0.12 : 1 + hop * 0.06;
					rig.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
					armLz = lerp(armLz, 0.7, hop);
					armRz = lerp(armRz, -0.7, hop);
					armLy = lerp(armLy, 0, hop);
					armRy = lerp(armRy, 0, hop);
					foreLx = lerp(foreLx, 0, hop);
					foreRx = lerp(foreRx, 0, hop);
				} else if (clip === "cheer") {
					// both arms pumping overhead with little hops
					const a = env(t, CLIP_DURATION.cheer);
					const hop = Math.abs(Math.sin(t * 6.5));
					rig.position.y = 0.09 * hop * a;
					const pump = 0.85 + 0.25 * Math.sin(t * 13);
					armLz = lerp(armLz, pump, a);
					armRz = lerp(armRz, -pump, a);
					armLy = lerp(armLy, 0, a);
					armRy = lerp(armRy, 0, a);
					foreLx = lerp(foreLx, 0, a);
					foreRx = lerp(foreRx, 0, a);
					foreLz = lerp(foreLz, 0.3 * Math.sin(t * 13), a);
					foreRz = lerp(foreRz, -0.3 * Math.sin(t * 13), a);
					headX += -a * 0.1 * hop;
				} else if (clip === "dance") {
					// hip twist, arms swinging between hip and shoulder height
					const a = env(t, CLIP_DURATION.dance);
					waistY = a * 0.35 * Math.sin(t * 6);
					spineY = -a * 0.2 * Math.sin(t * 6);
					spineZ = a * 0.08 * Math.sin(t * 3);
					armLz = lerp(armLz, -ARM_DOWN + 0.9 + 0.5 * Math.sin(t * 6), a);
					armRz = lerp(armRz, ARM_DOWN - 0.9 - 0.5 * Math.sin(t * 6 + Math.PI), a);
					armLy = lerp(armLy, 0.5 * twist, a);
					armRy = lerp(armRy, -0.5 * twist, a);
					foreLx = lerp(foreLx, -0.5, a);
					foreRx = lerp(foreRx, -0.5, a);
					headZ = a * 0.15 * Math.sin(t * 6 + 1);
					rig.position.y = a * 0.04 * Math.abs(Math.sin(t * 6));
				}

				// body-drag bend splits across waist + spine so he arcs toward the
				// grab point instead of tilting as one plank
				setBone("waist", fr.bendX * 0.5, waistY, fr.bendZ * 0.5);
				setBone("spine", fr.bendX * 0.5, spineY, spineZ + fr.bendZ * 0.5);
				setBone("head", headX, headY, headZ);
				setArm("armL", "forearmL", 1, { x: armLx, z: armLz, roll: armLy }, { x: foreLx, z: foreLz });
				setArm("armR", "forearmR", -1, { x: armRx, z: armRz, roll: armRy }, { x: foreRx, z: foreRz });
				// vinyl-toy stretch while a hand is being pulled
				bones.armL.scale.setScalar(1 + fr.armL.stretch);
				bones.armR.scale.setScalar(1 + fr.armR.stretch);
				// off-balance legs: the trailing leg lifts and its knee curls
				setBone("thighL", 0, 0, fr.legL.lift);
				setBone("calfL", fr.legL.curl, 0, 0);
				setBone("thighR", 0, 0, fr.legR.lift);
				setBone("calfR", fr.legR.curl, 0, 0);
			}
			grass.update(now, grassPos.copy(rig.position).add(pull.position));
			faceCtl?.update(now);
			controls.update();
			composer.render();
		};
		animate();

		// ---- tweak panel ----
		// every change persists to localStorage; /home3 reads the same state
		const persist = () => {
			settings.camPos = camera.position.toArray() as [number, number, number];
			settings.camTarget = controls.target.toArray() as [number, number, number];
			const { copySettings: _c, resetSettings: _r, resetCamera: _rc, saveConfig: _sv, downloadConfig: _d, loadConfig: _l, showSkeleton: _s, ...values } = settings;
			saveSettings(values);
		};
		controls.addEventListener("end", persist);

		settings.copySettings = () => {
			persist();
			const { copySettings: _c, resetSettings: _r, resetCamera: _rc, saveConfig: _sv, downloadConfig: _d, loadConfig: _l, showSkeleton: _s, ...values } = settings;
			const json = JSON.stringify(values, null, 2);
			console.log("[sidekick-3d] settings:", json);
			navigator.clipboard?.writeText(json).catch(() => {});
		};
		settings.resetSettings = () => {
			localStorage.removeItem(SETTINGS_KEY);
			window.location.reload();
		};
		// explicit save of the full config (all folders incl. the time-of-day
		// scene presets) to localStorage. Changes already auto-save on settle;
		// this is a belt-and-braces button + confirmation.
		settings.saveConfig = () => {
			persist();
			setStatus("config saved ✓");
			window.setTimeout(() => setStatus(""), 1500);
		};
		// save the full current config to a .json file on disk
		settings.downloadConfig = () => {
			persist();
			const { copySettings: _c, resetSettings: _r, resetCamera: _rc, saveConfig: _sv, downloadConfig: _d, loadConfig: _l, showSkeleton: _s, ...values } = settings;
			const blob = new Blob([JSON.stringify(values, null, 2)], { type: "application/json" });
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = "sidekick-config.json";
			a.click();
			URL.revokeObjectURL(a.href);
		};
		// load a config .json from disk → localStorage → reload so the scene rebuilds
		settings.loadConfig = () => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = "application/json,.json";
			input.onchange = () => {
				const file = input.files?.[0];
				if (!file) return;
				file.text().then((txt) => {
					try {
						saveSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(txt) });
						window.location.reload();
					} catch (err) {
						console.error("[sidekick-3d] invalid config file:", err);
						setStatus("invalid config file");
					}
				});
			};
			input.click();
		};
		settings.resetCamera = () => {
			camera.position.fromArray(DEFAULT_CAM_POS);
			controls.target.fromArray(DEFAULT_CAM_TARGET);
			settings.fov = DEFAULT_SETTINGS.fov;
			camera.fov = settings.fov;
			camera.updateProjectionMatrix();
			persist();
		};

		const gui = new GUI({ title: "Sidekick 3D" });
		gui.onFinishChange(persist);

		const cam = gui.addFolder("Camera");
		cam.add(settings, "fov", 15, 70).name("fov").listen().onChange((v: number) => {
			camera.fov = v;
			camera.updateProjectionMatrix();
		});
		// same lens in photographic terms (full-frame mm); writes fov
		const lensCtl = {
			get focalLength() { return focalLengthFromFov(settings.fov); },
			set focalLength(mm: number) {
				settings.fov = fovFromFocalLength(mm);
				camera.fov = settings.fov;
				camera.updateProjectionMatrix();
			},
		};
		cam.add(lensCtl, "focalLength", 18, 200, 1).name("focal length (mm)");
		// direct position/target controls, two-way synced with the orbit controls
		const camCtl = {
			get x() { return camera.position.x; },
			set x(v: number) { camera.position.x = v; },
			get y() { return camera.position.y; },
			set y(v: number) { camera.position.y = v; },
			get z() { return camera.position.z; },
			set z(v: number) { camera.position.z = v; },
			get targetX() { return controls.target.x; },
			set targetX(v: number) { controls.target.x = v; },
			get targetY() { return controls.target.y; },
			set targetY(v: number) { controls.target.y = v; },
			get targetZ() { return controls.target.z; },
			set targetZ(v: number) { controls.target.z = v; },
		};
		cam.add(camCtl, "x", -10, 10, 0.01).name("position x").listen();
		cam.add(camCtl, "y", -5, 10, 0.01).name("position y").listen();
		cam.add(camCtl, "z", -10, 12, 0.01).name("position z").listen();
		cam.add(camCtl, "targetX", -3, 3, 0.01).name("target x").listen();
		cam.add(camCtl, "targetY", -3, 3, 0.01).name("target y").listen();
		cam.add(camCtl, "targetZ", -3, 3, 0.01).name("target z").listen();
		cam.add(settings, "resetCamera").name("reset camera");
		cam.add(
			{ note: "drag to orbit · scroll to zoom — saved automatically" },
			"note",
		).disable();
		// apply the ACTIVE time-of-day scene preset to everything: sky, fog,
		// grass palette, light rig, exposure, and the character (cel) tint/shade
		const applyScene = () => {
			const sc = settings.scenes[settings.timeOfDay];
			(scene.background as THREE.Texture).dispose();
			scene.background = makeSky(sc);
			{
				const fog = scene.fog as THREE.Fog;
				fog.color.set(sc.fog);
				fog.near = sc.fogNear;
				fog.far = sc.fogFar;
			}
			grass.setColors(sc.grassHill, sc.grassBase, sc.grassTip, sc.rock);
			hemi.color.set(sc.hemiSky);
			hemi.groundColor.set(sc.hemiGround);
			hemi.intensity = sc.hemiIntensity;
			key.color.set(sc.keyColor);
			key.intensity = sc.keyIntensity;
			fill.color.set(sc.fillColor);
			fill.intensity = sc.fillIntensity;
			rim.color.set(sc.rimColor);
			rim.intensity = sc.rimIntensity;
			renderer.toneMappingExposure = sc.exposure;
			rebuildShading(); // re-tint the cel character for the scene
			persist();
		};

		// Time of Day panel: pick day/evening/night, then tune EVERY variable of
		// that preset live. The variables sub-folder rebuilds when the scene changes.
		const todFolder = gui.addFolder("Time of Day");
		let sceneVars: GUI | null = null;
		const buildSceneVars = () => {
			if (sceneVars) sceneVars.destroy();
			sceneVars = todFolder.addFolder(`${settings.timeOfDay} variables`);
			const sc = settings.scenes[settings.timeOfDay];
			sceneVars.addColor(sc, "skyTop").name("sky top").onChange(applyScene);
			sceneVars.addColor(sc, "skyMid").name("sky mid").onChange(applyScene);
			sceneVars.addColor(sc, "skyHorizon").name("sky horizon").onChange(applyScene);
			sceneVars.addColor(sc, "fog").name("fog color").onChange(applyScene);
			sceneVars.add(sc, "fogNear", 0, 40, 0.5).name("fog near").onChange(applyScene);
			sceneVars.add(sc, "fogFar", 5, 120, 0.5).name("fog far").onChange(applyScene);
			sceneVars.addColor(sc, "grassHill").name("grass hill").onChange(applyScene);
			sceneVars.addColor(sc, "grassBase").name("grass base").onChange(applyScene);
			sceneVars.addColor(sc, "grassTip").name("grass tip").onChange(applyScene);
			sceneVars.addColor(sc, "rock").name("rock color").onChange(applyScene);
			sceneVars.addColor(sc, "charTint").name("character tint").onChange(applyScene);
			sceneVars.addColor(sc, "shadeColor").name("shade color").onChange(applyScene);
			sceneVars.addColor(sc, "keyColor").name("key color").onChange(applyScene);
			sceneVars.add(sc, "keyIntensity", 0, 4, 0.05).name("key intensity").onChange(applyScene);
			sceneVars.addColor(sc, "fillColor").name("fill color").onChange(applyScene);
			sceneVars.add(sc, "fillIntensity", 0, 3, 0.05).name("fill intensity").onChange(applyScene);
			sceneVars.addColor(sc, "rimColor").name("rim color").onChange(applyScene);
			sceneVars.add(sc, "rimIntensity", 0, 4, 0.05).name("rim intensity").onChange(applyScene);
			sceneVars.addColor(sc, "hemiSky").name("hemi sky").onChange(applyScene);
			sceneVars.addColor(sc, "hemiGround").name("hemi ground").onChange(applyScene);
			sceneVars.add(sc, "hemiIntensity", 0, 2, 0.02).name("hemi intensity").onChange(applyScene);
			sceneVars.add(sc, "exposure", 0.3, 2, 0.01).onChange(applyScene);
		};
		todFolder.add(settings, "timeOfDay", TIMES).name("scene").onChange(() => {
			buildSceneVars();
			applyScene();
		});
		buildSceneVars();

		const envFolder = gui.addFolder("Environment");
		const relayoutGrass = () => grass.relayout(settings.grassHeight, settings.grassClumping);
		envFolder.add(settings, "grassHeight", 0.3, 2.5, 0.01).name("grass height").onChange(relayoutGrass);
		envFolder.add(settings, "grassClumping", 0, 1, 0.01).name("grass clumping").onChange(relayoutGrass);

		// transient face test controls (not persisted — expressions are runtime state)
		const faceCfg = { expression: "neutral" as FaceExpression, talking: false, blinking: true };
		const faceFolder = gui.addFolder("Face");
		faceFolder.add(faceCfg, "expression", FACE_EXPRESSIONS).onChange((e: FaceExpression) => faceCtl?.set(e));
		faceFolder.add(faceCfg, "talking").onChange((v: boolean) => faceCtl?.setTalking(v));
		faceFolder.add(faceCfg, "blinking").onChange((v: boolean) => faceCtl?.setBlinking(v));
		faceFolder.add(settings, "faceZoom", 0.9, 2, 0.01).name("face size").onChange((v: number) => faceCtl?.setScale(v));
		faceFolder.add(settings, "faceHeight", -0.25, 0.25, 0.005).name("face height").onChange((v: number) => faceCtl?.setOffsetY(v));

		// Equipment folder is populated from the manifest once cosmetics load
		// (buildEquipGui runs from the GLB load callback after cos.ready), so any
		// slot the art pipeline adds shows up here with no code change.
		// Equipment gets its OWN panel, docked on the LEFT (the main panel is
		// right). Populated from the manifest once cosmetics load (buildEquipGui
		// runs from the GLB load callback after cos.ready), so any slot the art
		// pipeline adds shows up here with no code change.
		const equipGui = new GUI({ title: "Equipment" });
		equipGui.domElement.style.left = "0px";
		equipGui.domElement.style.right = "auto";
		equipGui.onFinishChange(persist);
		equipGui
			.addColor(settings, "shirtColor")
			.name("shirt color (plain)")
			.onChange(() => cos?.refresh(settings, matcapTex));
		buildEquipGui = (c) => {
			const slots = c.slots();
			for (const [slot, def] of Object.entries(slots)) {
				const cfg = { on: slot === "shirt" && settings.shirtEnabled, variant: def.variants[0]?.id ?? "" };
				const sf = equipGui.addFolder(slot);
				sf.add(cfg, "on").name("equip").onChange((v: boolean) => (v ? c.equip(slot, cfg.variant) : c.setVisible(slot, false)));
				if (def.variants.length > 1 || def.variants[0]?.tex) {
					sf.add(cfg, "variant", def.variants.map((x) => x.id)).name("variant").onChange((v: string) => c.equip(slot, v));
				}
			}
		};

		const pose = gui.addFolder("Pose");
		pose.add(settings, "poseArmDown", 0, 1.6, 0.01).name("arm drop");
		pose.add(settings, "poseArmTwist", -3.2, 3.2, 0.01).name("palm roll");
		pose.add(settings, "poseRollSplit", 0, 1, 0.01).name("roll split shoulder↔elbow");
		pose.add(settings, "poseArmForward", -0.8, 0.8, 0.01).name("arms forward");
		pose.add(settings, "poseForeBend", -1, 1, 0.01).name("elbow bend");

		const sh = gui.addFolder("Shading");
		sh.add(settings, "shading", ["physical", "toon", "ramp", "gooch", "halftone", "sss", "matcap", "cel"]);
		sh.addColor(settings, "celBodyColor").name("cel body color");
		sh.addColor(settings, "celShadowColor").name("cel shadow");
		sh.add(settings, "celSoftness", 0, 1).name("cel softness");
		sh.add(settings, "celShadowAmt", 0, 1).name("cel shadow amt");
		sh.add(settings, "toonBands", 2, 5, 1);
		sh.add(settings, "toonSoftness", 0, 1);
		sh.add(settings, "toonSpecStrength", 0, 1);
		sh.add(settings, "toonSpecSize", 0, 1);
		sh.add(settings, "toonRimStrength", 0, 1);
		sh.addColor(settings, "toonShadowColor");
		sh.add(settings, "toonShadowAmt", 0, 1);
		sh.addColor(settings, "rampMid");
		sh.addColor(settings, "rampLight");
		sh.addColor(settings, "goochCool");
		sh.addColor(settings, "goochWarm");
		sh.add(settings, "halftoneScale", 4, 30);
		sh.addColor(settings, "sssColor");
		sh.add(settings, "sssStrength", 0, 1);
		sh.add(settings, "outline").onChange((v: boolean) => {
			if (outlineMesh) outlineMesh.visible = v;
		});
		sh.add(settings, "outlineWidth", 0, 0.02);
		sh.addColor(settings, "outlineColor");
		// any settled change in this folder rebuilds the active materials
		sh.onFinishChange(rebuildShading);
		sh.add(
			{ note: "matcap looks for /matcap.png (Cycles sphere render)" },
			"note",
		).disable();

		const mat = gui.addFolder("Material (physical mode)");
		mat.addColor(settings, "tint").onChange((v: string) => vinyl.color.set(v));
		mat.add(settings, "roughness", 0, 1).onChange((v: number) => (vinyl.roughness = v));
		mat.add(settings, "clearcoat", 0, 1).onChange((v: number) => (vinyl.clearcoat = v));
		mat.add(settings, "clearcoatRoughness", 0, 1).onChange((v: number) => (vinyl.clearcoatRoughness = v));
		mat.add(settings, "sheen", 0, 1).onChange((v: number) => (vinyl.sheen = v));
		mat.add(settings, "sheenRoughness", 0, 1).onChange((v: number) => (vinyl.sheenRoughness = v));
		mat.addColor(settings, "sheenColor").onChange((v: string) => vinyl.sheenColor.set(v));
		mat.addColor(settings, "emissiveColor").onChange((v: string) => vinyl.emissive.set(v));
		mat.add(settings, "emissiveIntensity", 0, 0.5).onChange((v: number) => (vinyl.emissiveIntensity = v));

		// key / fill / rim / hemi / exposure now live in the Time of Day panel
		// (per-scene); only the IBL intensity remains a global here
		const lit = gui.addFolder("Lighting");
		lit.add(settings, "envIntensity", 0, 3).name("env (IBL) intensity").onChange((v: number) => (scene.environmentIntensity = v));
		lit.close();

		const blo = gui.addFolder("Bloom");
		blo.add(settings, "bloomEnabled").onChange((v: boolean) => (bloom.enabled = v));
		blo.add(settings, "bloomStrength", 0, 1).onChange((v: number) => (bloom.strength = v));
		blo.add(settings, "bloomRadius", 0, 1.5).onChange((v: number) => (bloom.radius = v));
		blo.add(settings, "bloomThreshold", 0, 1).onChange((v: number) => (bloom.threshold = v));
		blo.close();

		const dof = gui.addFolder("Depth of field");
		dof.add(settings, "dofEnabled").name("enabled").onChange((v: boolean) => (bokeh.enabled = v));
		dof.add(settings, "dofFocus", 1, 12, 0.05).name("focus dist").onChange((v: number) => ((bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = v));
		dof.add(settings, "dofAperture", 0, 10, 0.05).name("aperture ×1e-4").onChange((v: number) => ((bokeh.uniforms as Record<string, THREE.IUniform>).aperture.value = v * 1e-4));
		dof.add(settings, "dofMaxBlur", 0, 0.03, 0.001).name("max blur").onChange((v: number) => ((bokeh.uniforms as Record<string, THREE.IUniform>).maxblur.value = v));
		dof.close();

		const ts = gui.addFolder("Tilt-shift");
		ts.add(settings, "tiltEnabled").name("enabled").onChange((v: boolean) => (tilt.enabled = v));
		ts.add(settings, "tiltFocusY", 0, 1, 0.01).name("band center").onChange((v: number) => (tilt.uniforms.uFocusY.value = v));
		ts.add(settings, "tiltBand", 0, 0.5, 0.01).name("band width").onChange((v: number) => (tilt.uniforms.uBand.value = v));
		ts.add(settings, "tiltBlur", 0, 8, 0.1).name("blur").onChange((v: number) => (tilt.uniforms.uBlur.value = v));
		ts.close();

		const scn = gui.addFolder("Scene");
		scn.add(settings, "shadowOpacity", 0, 0.6).onChange((v: number) => (key.shadow.intensity = v * 3));
		scn.add(settings, "autoRotate").onChange((v: boolean) => (controls.autoRotate = v));
		scn.add(settings, "showSkeleton").onChange((v: boolean) => {
			if (skeletonHelper) skeletonHelper.visible = v;
		});
		scn.close();

		// checked-in presets: apply = overwrite saved state + reload, same
		// semantics as "load config (.json)" but sourced from the repo
		const presetNames = Object.keys(CONFIG_PRESETS).sort();
		if (presetNames.length) {
			const presetCtl = {
				preset: presetNames[0],
				apply: () => {
					saveSettings({ ...DEFAULT_SETTINGS, ...CONFIG_PRESETS[presetCtl.preset] });
					window.location.reload();
				},
			};
			const pf = gui.addFolder("Config presets");
			pf.add(presetCtl, "preset", presetNames);
			pf.add(presetCtl, "apply").name("apply preset (reloads)");
		}

		gui.add(settings, "saveConfig").name("💾 save config");
		gui.add(settings, "copySettings").name("copy settings JSON");
		gui.add(settings, "downloadConfig").name("download config (.json)");
		gui.add(settings, "loadConfig").name("load config (.json)");
		gui.add(settings, "resetSettings").name("reset all to defaults");

		const onResize = () => {
			camera.aspect = mount.clientWidth / mount.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(mount.clientWidth, mount.clientHeight);
			composer.setSize(mount.clientWidth, mount.clientHeight);
			tilt.uniforms.uResolution.value.set(mount.clientWidth, mount.clientHeight);
		};
		window.addEventListener("resize", onResize);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			cos?.dispose();
			interact.dispose();
			gui.destroy();
			equipGui.destroy();
			controls.dispose();
			pmrem.dispose();
			composer.dispose();
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, []);

	const btn =
		"rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-gray-700 shadow hover:bg-white active:scale-95 transition";

	return (
		<div className="relative h-screen w-screen">
			<div ref={mountRef} className="h-full w-full" />
			<div className="absolute left-4 top-4 rounded-lg bg-white/80 px-3 py-2 text-sm text-gray-700 shadow">
				<div className="font-semibold">Sidekick 3D — rigged</div>
				<div className="text-xs text-gray-500">
					{status || "drag to orbit · he watches your cursor"}
				</div>
			</div>
			<div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2">
				<button className={btn} onClick={() => playRef.current("wave")}>👋 Wave</button>
				<button className={btn} onClick={() => playRef.current("jump")}>🦘 Jump</button>
				<button className={btn} onClick={() => playRef.current("cheer")}>🎉 Cheer</button>
				<button className={btn} onClick={() => playRef.current("dance")}>🕺 Dance</button>
			</div>
		</div>
	);
}
