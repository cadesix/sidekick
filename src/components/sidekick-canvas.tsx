import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadSettings } from "./sidekick-settings";
import {
	MODEL_URL,
	SUN_DIR,
	makeCharacterMaterials,
	makeEnvScene,
	makeOutlineMaterial,
	loadMatcapTexture,
	type TexSet,
} from "./sidekick-shading";
import { makeGrassEnvironment } from "./sidekick-grass";
import { makeSky } from "./sidekick-scene";
import { makeLandscape } from "./sidekick-landscape";
import { createFaceController, loadFaceTexture, type FaceController } from "./sidekick-face";
import { createInteraction, POKE_FACE } from "./sidekick-interact";
import { createCosmetics, type CosmeticsHandle } from "./sidekick-equipment";

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

export function SidekickCanvas({
	className,
	framing,
	landscape,
	holdingPhone,
}: {
	className?: string;
	framing?: CanvasFraming;
	landscape?: boolean;
	holdingPhone?: boolean;
}) {
	const mountRef = useRef<HTMLDivElement>(null);
	// kept current so the render loop can ease the camera toward a new framing
	// (e.g. /home4 zooms out when the chat drawer opens) without re-mounting
	const framingRef = useRef(framing);
	framingRef.current = framing;
	// when true, the character raises its right hand + looks down at the phone
	const phoneRef = useRef(holdingPhone);
	phoneRef.current = holdingPhone;

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const s = loadSettings();

		const sc = s.scenes[s.timeOfDay];
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
		scene.add(new THREE.HemisphereLight(new THREE.Color(sc.hemiSky), new THREE.Color(sc.hemiGround), sc.hemiIntensity));
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
		const applyShading = () => {
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
				// modular equipment: manifest-driven cosmetics bound to this rig
				if (bodyMesh) {
					cos = createCosmetics(bodyMesh, s, matcapTex);
					if (s.shirtEnabled) cos.equip("shirt");
					// preload the phone into the hand, hidden until holdingPhone
					cos.equip("phone").then(() => cos?.setVisible("phone", false));
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
			cameraDrag: true,
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
		const wantPos = new THREE.Vector3();
		const wantTgt = new THREE.Vector3();
		let phoneBlend = 0; // 0 idle → 1 holding the phone up
		let phoneShown = false;
		const lerp = THREE.MathUtils.lerp;
		const animate = () => {
			raf = requestAnimationFrame(animate);
			const now = clock.getElapsedTime();
			const fr = interact.update(now);
			// body-drag lean/offset/squash (springs home to rest on release)
			pull.position.set(fr.bodyX, 0, fr.bodyZ);
			pull.rotation.set(fr.tiltX, 0, fr.tiltZ);
			pull.scale.set(1 / Math.sqrt(fr.squash), fr.squash, 1 / Math.sqrt(fr.squash));
			if (ready) {
				const breath = 1 + Math.sin(now * 2.2) * 0.012;
				rig.scale.set(1 / Math.sqrt(breath), breath, 1 / Math.sqrt(breath));
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
				// both arms blend from idle toward the two-handed phone-hold pose
				setArm(
					"armL",
					"forearmL",
					1,
					lerp(s.poseArmForward + fr.armL.fwd, PHONE_L.swingX, pb),
					lerp(-s.poseArmDown + sway + fr.armL.swing, PHONE_L.swingZ, pb),
					lerp(s.poseArmTwist, PHONE_L.twist, pb),
					lerp(s.poseForeBend, PHONE_L.foreX, pb),
					lerp(0, PHONE_L.foreZ, pb),
				);
				setArm(
					"armR",
					"forearmR",
					-1,
					lerp(s.poseArmForward + fr.armR.fwd, PHONE_R.swingX, pb),
					lerp(s.poseArmDown - sway + fr.armR.swing, PHONE_R.swingZ, pb),
					lerp(-s.poseArmTwist, PHONE_R.twist, pb),
					lerp(s.poseForeBend, PHONE_R.foreX, pb),
					lerp(0, PHONE_R.foreZ, pb),
				);
				bones.armL.scale.setScalar(1 + fr.armL.stretch);
				bones.armR.scale.setScalar(1 + fr.armR.stretch);
				setBone("head", fr.headPitch + PHONE_POSE.headPitch * pb, fr.headYaw + PHONE_POSE.headYaw * pb, 0);
				// body-drag bend splits across waist + spine (arc toward the grab
				// point); the trailing leg lifts and its knee curls when off balance
				setBone("waist", fr.bendX * 0.5, 0, fr.bendZ * 0.5);
				setBone("spine", fr.bendX * 0.5, 0, fr.bendZ * 0.5);
				setBone("thighL", 0, 0, fr.legL.lift);
				setBone("calfL", fr.legL.curl, 0, 0);
				setBone("thighR", 0, 0, fr.legR.lift);
				setBone("calfR", fr.legR.curl, 0, 0);
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
			grass.update(now, pull.position);
			faceCtl?.update(now);
			renderer.render(scene, camera);
		};
		animate();

		const onResize = () => {
			camera.aspect = mount.clientWidth / mount.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(mount.clientWidth, mount.clientHeight);
		};
		window.addEventListener("resize", onResize);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			cos?.dispose();
			interact.dispose();
			pmrem.dispose();
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, []);

	return <div ref={mountRef} className={className} aria-hidden="true" />;
}
