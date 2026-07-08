import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import GUI from "lil-gui";
import {
	DEFAULT_SETTINGS,
	SETTINGS_KEY,
	loadSettings,
	saveSettings,
} from "./components/sidekick-settings";
import {
	MODEL_URL,
	makeCharacterMaterials,
	makeEnvScene,
	makeOutlineMaterial,
	makePhysicalMaterial,
	loadMatcapTexture,
	type TexSet,
} from "./components/sidekick-shading";
import { makeGrassEnvironment, makeSkyTexture } from "./components/sidekick-grass";
import { createInteraction, POKE_FACE } from "./components/sidekick-interact";
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
			showSkeleton: false,
		});

		const scene = new THREE.Scene();
		// real 3D lawn: sky gradient + domed hill + instanced wind-swept grass
		scene.background = makeSkyTexture(settings.skyTop, settings.skyHorizon);
		scene.fog = new THREE.Fog(settings.skyHorizon, 8, 30);
		const grass = makeGrassEnvironment();
		grass.setColors(settings.grassHill, settings.grassBase, settings.grassTip);
		grass.relayout(settings.grassHeight, settings.grassClumping);
		scene.add(grass.group);
		const applyEnvColors = () => {
			(scene.background as THREE.Texture).dispose();
			scene.background = makeSkyTexture(settings.skyTop, settings.skyHorizon);
			(scene.fog as THREE.Fog).color.set(settings.skyHorizon);
			grass.setColors(settings.grassHill, settings.grassBase, settings.grassTip);
		};

		const DEFAULT_CAM_POS: [number, number, number] = [0, 0.75, 2.6];
		const DEFAULT_CAM_TARGET: [number, number, number] = [0, 0.45, 0];
		const camera = new THREE.PerspectiveCamera(settings.fov, mount.clientWidth / mount.clientHeight, 0.1, 50);
		camera.position.fromArray(settings.camPos ?? DEFAULT_CAM_POS);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = settings.exposure;
		mount.appendChild(renderer.domElement);

		// warm sunset IBL from the procedural env scene
		const pmrem = new THREE.PMREMGenerator(renderer);
		scene.environment = pmrem.fromScene(makeEnvScene(), 0.04).texture;
		scene.environmentIntensity = settings.envIntensity;

		// bloom for the glossy highlight sparkle
		const composer = new EffectComposer(renderer);
		composer.addPass(new RenderPass(scene, camera));
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

		// warm key / pink fill / bright rim, matching the reference look
		const hemi = new THREE.HemisphereLight(0xffe9d2, 0xe8b49a, settings.hemiIntensity);
		scene.add(hemi);
		const key = new THREE.DirectionalLight(new THREE.Color(settings.keyColor), settings.keyIntensity);
		key.position.set(2, 3, 2);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.radius = 6;
		scene.add(key);
		const fill = new THREE.DirectionalLight(new THREE.Color(settings.fillColor), settings.fillIntensity);
		fill.position.set(-2.5, 1.2, 1.5);
		scene.add(fill);
		const rim = new THREE.DirectionalLight(new THREE.Color(settings.rimColor), settings.rimIntensity);
		rim.position.set(-1, 2.5, -2.5);
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
				faceCtl = createFaceController(t, settings.faceScale);
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
			targets: () => [bodyMesh, faceMesh].filter(Boolean) as THREE.Object3D[],
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
			const { copySettings: _c, resetSettings: _r, resetCamera: _rc, showSkeleton: _s, ...values } = settings;
			saveSettings(values);
		};
		controls.addEventListener("end", persist);

		settings.copySettings = () => {
			persist();
			const { copySettings: _c, resetSettings: _r, resetCamera: _rc, showSkeleton: _s, ...values } = settings;
			const json = JSON.stringify(values, null, 2);
			console.log("[sidekick-3d] settings:", json);
			navigator.clipboard?.writeText(json).catch(() => {});
		};
		settings.resetSettings = () => {
			localStorage.removeItem(SETTINGS_KEY);
			window.location.reload();
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
		cam.add(settings, "fov", 15, 70).onChange((v: number) => {
			camera.fov = v;
			camera.updateProjectionMatrix();
		});
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
		const envFolder = gui.addFolder("Environment");
		envFolder.addColor(settings, "skyTop").onChange(applyEnvColors);
		envFolder.addColor(settings, "skyHorizon").onChange(applyEnvColors);
		envFolder.addColor(settings, "grassHill").onChange(applyEnvColors);
		envFolder.addColor(settings, "grassBase").onChange(applyEnvColors);
		envFolder.addColor(settings, "grassTip").onChange(applyEnvColors);
		const relayoutGrass = () => grass.relayout(settings.grassHeight, settings.grassClumping);
		envFolder.add(settings, "grassHeight", 0.3, 2.5, 0.01).name("grass height").onChange(relayoutGrass);
		envFolder.add(settings, "grassClumping", 0, 1, 0.01).name("grass clumping").onChange(relayoutGrass);

		// transient face test controls (not persisted — expressions are runtime state)
		const faceCfg = { expression: "neutral" as FaceExpression, talking: false, blinking: true };
		const faceFolder = gui.addFolder("Face");
		faceFolder.add(faceCfg, "expression", FACE_EXPRESSIONS).onChange((e: FaceExpression) => faceCtl?.set(e));
		faceFolder.add(faceCfg, "talking").onChange((v: boolean) => faceCtl?.setTalking(v));
		faceFolder.add(faceCfg, "blinking").onChange((v: boolean) => faceCtl?.setBlinking(v));
		faceFolder.add(settings, "faceScale", 0.9, 2, 0.01).name("face size").onChange((v: number) => faceCtl?.setScale(v));

		const pose = gui.addFolder("Pose");
		pose.add(settings, "poseArmDown", 0, 1.6, 0.01).name("arm drop");
		pose.add(settings, "poseArmTwist", -3.2, 3.2, 0.01).name("palm roll");
		pose.add(settings, "poseRollSplit", 0, 1, 0.01).name("roll split shoulder↔elbow");
		pose.add(settings, "poseArmForward", -0.8, 0.8, 0.01).name("arms forward");
		pose.add(settings, "poseForeBend", -1, 1, 0.01).name("elbow bend");

		const sh = gui.addFolder("Shading");
		sh.add(settings, "shading", ["physical", "toon", "ramp", "gooch", "halftone", "sss", "matcap"]);
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

		const lit = gui.addFolder("Lighting");
		lit.add(settings, "exposure", 0.3, 2).onChange((v: number) => (renderer.toneMappingExposure = v));
		lit.add(settings, "envIntensity", 0, 3).onChange((v: number) => (scene.environmentIntensity = v));
		lit.add(settings, "keyIntensity", 0, 4).onChange((v: number) => (key.intensity = v));
		lit.addColor(settings, "keyColor").onChange((v: string) => key.color.set(v));
		lit.add(settings, "fillIntensity", 0, 4).onChange((v: number) => (fill.intensity = v));
		lit.addColor(settings, "fillColor").onChange((v: string) => fill.color.set(v));
		lit.add(settings, "rimIntensity", 0, 4).onChange((v: number) => (rim.intensity = v));
		lit.addColor(settings, "rimColor").onChange((v: string) => rim.color.set(v));
		lit.add(settings, "hemiIntensity", 0, 2).onChange((v: number) => (hemi.intensity = v));
		lit.close();

		const blo = gui.addFolder("Bloom");
		blo.add(settings, "bloomEnabled").onChange((v: boolean) => (bloom.enabled = v));
		blo.add(settings, "bloomStrength", 0, 1).onChange((v: number) => (bloom.strength = v));
		blo.add(settings, "bloomRadius", 0, 1.5).onChange((v: number) => (bloom.radius = v));
		blo.add(settings, "bloomThreshold", 0, 1).onChange((v: number) => (bloom.threshold = v));
		blo.close();

		const scn = gui.addFolder("Scene");
		scn.add(settings, "shadowOpacity", 0, 0.6).onChange((v: number) => (key.shadow.intensity = v * 3));
		scn.add(settings, "autoRotate").onChange((v: boolean) => (controls.autoRotate = v));
		scn.add(settings, "showSkeleton").onChange((v: boolean) => {
			if (skeletonHelper) skeletonHelper.visible = v;
		});
		scn.close();

		gui.add(settings, "copySettings").name("copy settings JSON");
		gui.add(settings, "resetSettings").name("reset all to defaults");

		const onResize = () => {
			camera.aspect = mount.clientWidth / mount.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(mount.clientWidth, mount.clientHeight);
			composer.setSize(mount.clientWidth, mount.clientHeight);
		};
		window.addEventListener("resize", onResize);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			interact.dispose();
			gui.destroy();
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
