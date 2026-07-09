import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadSettings } from "./sidekick-settings";
import {
	MODEL_URL,
	makeCharacterMaterials,
	makeEnvScene,
	makeOutlineMaterial,
	loadMatcapTexture,
	type TexSet,
} from "./sidekick-shading";
import { makeGrassEnvironment, makeSkyTexture } from "./sidekick-grass";
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
}: {
	className?: string;
	framing?: CanvasFraming;
}) {
	const mountRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const s = loadSettings();

		const scene = new THREE.Scene();
		scene.background = makeSkyTexture(s.skyTop, s.skyHorizon);
		scene.fog = new THREE.Fog(s.skyHorizon, 8, 30);
		const grass = makeGrassEnvironment();
		grass.setColors(s.grassHill, s.grassBase, s.grassTip);
		grass.relayout(s.grassHeight, s.grassClumping);
		scene.add(grass.group);

		const camera = new THREE.PerspectiveCamera(framing?.fov ?? s.fov, mount.clientWidth / mount.clientHeight, 0.1, 60);
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
		renderer.toneMappingExposure = s.exposure;
		mount.appendChild(renderer.domElement);

		// same warm-panel IBL as the viewer so the vinyl reads identically
		const pmrem = new THREE.PMREMGenerator(renderer);
		scene.environment = pmrem.fromScene(makeEnvScene(), 0.04).texture;
		scene.environmentIntensity = s.envIntensity;

		// lighting rig mirrors /sidekick-3d exactly, driven by the same settings
		scene.add(new THREE.HemisphereLight(0xffe9d2, 0xe8b49a, s.hemiIntensity));
		const key = new THREE.DirectionalLight(new THREE.Color(s.keyColor), s.keyIntensity);
		key.position.set(2, 3, 2);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.radius = 6;
		scene.add(key);
		const fill = new THREE.DirectionalLight(new THREE.Color(s.fillColor), s.fillIntensity);
		fill.position.set(-2.5, 1.2, 1.5);
		scene.add(fill);
		const rim = new THREE.DirectionalLight(new THREE.Color(s.rimColor), s.rimIntensity);
		rim.position.set(-1, 2.5, -2.5);
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
		const setArm = (arm: BoneName, forearm: BoneName, side: 1 | -1, swingX: number, swingZ: number, roll: number, foreX: number) => {
			qSwing.setFromEuler(e.set(swingX, 0, swingZ));
			armAxis.set(side, 0, 0).applyQuaternion(qSwing);
			qRoll.setFromAxisAngle(armAxis, roll * s.poseRollSplit);
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(arm, qArm);
			qSwing.setFromEuler(e.set(foreX, 0, 0));
			qRoll.setFromAxisAngle(armAxis, roll * (1 - s.poseRollSplit));
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(forearm, qArm);
		};

		let raf = 0;
		const clock = new THREE.Clock();
		const camSph = new THREE.Spherical();
		const camOff = new THREE.Vector3();
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
				setArm("armL", "forearmL", 1, s.poseArmForward + fr.armL.fwd, -s.poseArmDown + sway + fr.armL.swing, s.poseArmTwist, s.poseForeBend);
				setArm("armR", "forearmR", -1, s.poseArmForward + fr.armR.fwd, s.poseArmDown - sway + fr.armR.swing, -s.poseArmTwist, s.poseForeBend);
				bones.armL.scale.setScalar(1 + fr.armL.stretch);
				bones.armR.scale.setScalar(1 + fr.armR.stretch);
				setBone("head", fr.headPitch, fr.headYaw, 0);
				// body-drag bend splits across waist + spine (arc toward the grab
				// point); the trailing leg lifts and its knee curls when off balance
				setBone("waist", fr.bendX * 0.5, 0, fr.bendZ * 0.5);
				setBone("spine", fr.bendX * 0.5, 0, fr.bendZ * 0.5);
				setBone("thighL", 0, 0, fr.legL.lift);
				setBone("calfL", fr.legL.curl, 0, 0);
				setBone("thighR", 0, 0, fr.legR.lift);
				setBone("calfR", fr.legR.curl, 0, 0);
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
