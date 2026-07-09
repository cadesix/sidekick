import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "lil-gui";
import { loadSettings } from "./components/sidekick-settings";
import {
	MODEL_URL,
	SUN_DIR,
	makeCharacterMaterials,
	makeEnvScene,
	makeOutlineMaterial,
	loadMatcapTexture,
	type TexSet,
} from "./components/sidekick-shading";
import { makeGrassEnvironment } from "./components/sidekick-grass";
import { makeSky } from "./components/sidekick-scene";
import { createCosmetics, type CosmeticsHandle } from "./components/sidekick-equipment";
import { createFaceController, loadFaceTexture, type FaceController } from "./components/sidekick-face";

// Pose Studio (/pose): a hands-on rigging bench. Every joint the app can pose is
// exposed as a slider; equip the phone prop, drag the sliders until it looks
// right, then save the pose to a named library (localStorage) and/or copy it out
// as the PHONE_R / PHONE_L / PHONE_POSE constants used by sidekick-canvas.tsx.
// It applies the pose STATICALLY (no idle/breathe), so what you see is what saves.

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

type ArmPose = { swingX: number; swingZ: number; twist: number; foreX: number; foreZ: number };
type Pose = {
	phone: boolean;
	bodyYaw: number;
	head: { pitch: number; yaw: number; roll: number };
	armL: ArmPose;
	armR: ArmPose;
	waist: { x: number; z: number };
	spine: { x: number; z: number };
	legs: { thighL: number; thighR: number; calfL: number; calfR: number };
};

const POSES_KEY = "sidekick-poses-v1";

// the pose the app ships today (mirror of sidekick-canvas.tsx's PHONE_* consts),
// so the user can start from it and nudge.
const PHONE_HOLD: Pose = {
	phone: true,
	bodyYaw: 0.55,
	head: { pitch: 0.42, yaw: -0.22, roll: 0 },
	armL: { swingX: 0.5, swingZ: -2.4, twist: 0.4, foreX: -1.9, foreZ: 0 },
	armR: { swingX: 0.55, swingZ: 1.0, twist: 0.7, foreX: -1.7, foreZ: 0 },
	waist: { x: 0, z: 0 },
	spine: { x: 0, z: 0 },
	legs: { thighL: 0, thighR: 0, calfL: 0, calfR: 0 },
};

function makeIdlePose(armDown: number, armForward: number, armTwist: number, foreBend: number): Pose {
	return {
		phone: false,
		bodyYaw: 0,
		head: { pitch: 0, yaw: 0, roll: 0 },
		armL: { swingX: armForward, swingZ: -armDown, twist: armTwist, foreX: foreBend, foreZ: 0 },
		armR: { swingX: armForward, swingZ: armDown, twist: -armTwist, foreX: foreBend, foreZ: 0 },
		waist: { x: 0, z: 0 },
		spine: { x: 0, z: 0 },
		legs: { thighL: 0, thighR: 0, calfL: 0, calfR: 0 },
	};
}

const clone = (p: Pose): Pose => JSON.parse(JSON.stringify(p));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function loadPoses(): Record<string, Pose> {
	try {
		return JSON.parse(localStorage.getItem(POSES_KEY) ?? "{}");
	} catch {
		return {};
	}
}
function savePoses(all: Record<string, Pose>) {
	localStorage.setItem(POSES_KEY, JSON.stringify(all));
}

export default function PoseStudio() {
	const mountRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState("loading mesh…");
	const [toast, setToast] = useState("");

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;

		const settings = loadSettings();
		const sc0 = settings.scenes[settings.timeOfDay];

		const scene = new THREE.Scene();
		scene.background = makeSky(sc0);
		const grass = makeGrassEnvironment();
		grass.setColors(sc0.grassHill, sc0.grassBase, sc0.grassTip, sc0.rock);
		grass.relayout(settings.grassHeight, settings.grassClumping);
		scene.add(grass.group);

		const camera = new THREE.PerspectiveCamera(34, mount.clientWidth / mount.clientHeight, 0.1, 260);
		camera.position.set(0, 0.9, 3.2);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = sc0.exposure;
		mount.appendChild(renderer.domElement);

		const pmrem = new THREE.PMREMGenerator(renderer);
		scene.environment = pmrem.fromScene(makeEnvScene(), 0.04).texture;
		scene.environmentIntensity = settings.envIntensity;

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 0.62, 0);
		controls.enableDamping = true;
		controls.minDistance = 1.2;
		controls.maxDistance = 12;

		const hemi = new THREE.HemisphereLight(new THREE.Color(sc0.hemiSky), new THREE.Color(sc0.hemiGround), sc0.hemiIntensity);
		scene.add(hemi);
		const key = new THREE.DirectionalLight(new THREE.Color(sc0.keyColor), sc0.keyIntensity);
		key.position.copy(SUN_DIR).multiplyScalar(12);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.radius = 6;
		key.shadow.intensity = settings.shadowOpacity * 3;
		scene.add(key);
		const fill = new THREE.DirectionalLight(new THREE.Color(sc0.fillColor), sc0.fillIntensity);
		fill.position.set(-4, 1.5, 3);
		scene.add(fill);
		const rim = new THREE.DirectionalLight(new THREE.Color(sc0.rimColor), sc0.rimIntensity);
		rim.position.copy(SUN_DIR).multiplyScalar(8).setY(2.2);
		scene.add(rim);

		// ---- character ----
		let bodyMesh: THREE.SkinnedMesh | null = null;
		let faceMesh: THREE.SkinnedMesh | null = null;
		let outlineMesh: THREE.SkinnedMesh | null = null;
		let cos: CosmeticsHandle | null = null;
		let texSet: TexSet = { map: null, normalMap: null, vertexColors: false };
		let matcapTex: THREE.Texture | null = null;
		let faceTex: THREE.Texture | null = null;
		let faceCtl: FaceController | null = null;

		const rebuildShading = () => {
			if (!bodyMesh) return;
			const mats = makeCharacterMaterials(settings, texSet, matcapTex, faceTex);
			bodyMesh.material = mats.body;
			if (faceMesh) faceMesh.material = mats.face;
			if (outlineMesh) {
				outlineMesh.material = makeOutlineMaterial(settings);
				outlineMesh.visible = settings.outline;
			}
			cos?.refresh(settings, matcapTex);
		};
		loadMatcapTexture((t) => {
			matcapTex = t;
			rebuildShading();
		});
		loadFaceTexture((t) => {
			if (t) {
				faceTex = t;
				faceCtl = createFaceController(t, settings.faceZoom, settings.faceHeight);
				faceCtl.set("happy");
			}
			rebuildShading();
		});

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
							texSet = { map: orig.map, normalMap: null, vertexColors: !!geo.attributes.color };
							bodyMesh = child;
							child.castShadow = true;
						} else {
							faceMesh = child;
						}
						child.frustumCulled = false;
					}
				});
				if (bodyMesh) {
					const b = bodyMesh as THREE.SkinnedMesh;
					outlineMesh = new THREE.SkinnedMesh(b.geometry, makeOutlineMaterial(settings));
					outlineMesh.bind(b.skeleton, b.bindMatrix);
					outlineMesh.frustumCulled = false;
					outlineMesh.visible = settings.outline;
					b.parent!.add(outlineMesh);
				}
				rebuildShading();

				const box = new THREE.Box3().setFromObject(model);
				const height = box.max.y - box.min.y;
				const sc = 1 / height;
				model.scale.setScalar(sc);
				const center = box.getCenter(new THREE.Vector3());
				model.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
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

				if (bodyMesh) {
					cos = createCosmetics(bodyMesh, settings, matcapTex);
					if (settings.shirtEnabled) cos.equip("shirt");
					// preload the phone, hidden until the pose asks for it. Capture its
					// meshes + authored local transform so the Prop sliders can nudge the
					// phone's scale/offset (to hug the inner side, toward centre).
					cos.equip("phone").then(() => {
						cos?.setVisible("phone", pose.phone);
						bones.handR?.traverse((o) => {
							const m = o as THREE.Mesh;
							if (m.isMesh && /phone/i.test(m.name)) {
								phoneMeshes.push({ mesh: m, basePos: m.position.clone(), baseScale: m.scale.clone() });
							}
						});
						applyPhoneTransform();
					});
				}

				ready = true;
				setStatus("");
			},
			undefined,
			(err) => setStatus(`failed to load mesh: ${String(err)}`),
		);

		// ---- rig math (identical to sidekick-canvas / sidekick-3d) ----
		const e = new THREE.Euler();
		const qWorld = new THREE.Quaternion();
		const qParent = new THREE.Quaternion();
		const qLocal = new THREE.Quaternion();
		const setBoneQ = (name: BoneName, q: THREE.Quaternion) => {
			const bone = bones[name];
			if (!bone) return;
			bone.parent!.getWorldQuaternion(qParent);
			qLocal.copy(qParent).invert().multiply(q).multiply(qParent);
			bone.quaternion.copy(qLocal).multiply(rest[name]);
		};
		const setBone = (name: BoneName, ex: number, ey: number, ez: number) => {
			qWorld.setFromEuler(e.set(ex, ey, ez));
			setBoneQ(name, qWorld);
		};
		const qSwing = new THREE.Quaternion();
		const qRoll = new THREE.Quaternion();
		const qArm = new THREE.Quaternion();
		const armAxis = new THREE.Vector3();
		const setArm = (arm: BoneName, forearm: BoneName, side: 1 | -1, a: ArmPose) => {
			const split = settings.poseRollSplit;
			qSwing.setFromEuler(e.set(a.swingX, 0, a.swingZ));
			armAxis.set(side, 0, 0).applyQuaternion(qSwing);
			qRoll.setFromAxisAngle(armAxis, a.twist * split);
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(arm, qArm);
			qSwing.setFromEuler(e.set(a.foreX, 0, a.foreZ));
			qRoll.setFromAxisAngle(armAxis, a.twist * (1 - split));
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(forearm, qArm);
		};

		// live pose object the GUI drives; applied statically every frame
		const idle = makeIdlePose(settings.poseArmDown, settings.poseArmForward, settings.poseArmTwist, settings.poseForeBend);
		const pose: Pose = clone(idle);
		let phoneShown = pose.phone;

		// phone prop tuning (on top of the manifest scale). offset is in hand-local
		// units and hugs the phone toward the inner/centre side of the hand.
		const phoneAdj = { scale: 1, offX: 0, offY: 0, offZ: 0 };
		const phoneMeshes: { mesh: THREE.Mesh; basePos: THREE.Vector3; baseScale: THREE.Vector3 }[] = [];
		const applyPhoneTransform = () => {
			for (const pm of phoneMeshes) {
				pm.mesh.position.set(pm.basePos.x + phoneAdj.offX, pm.basePos.y + phoneAdj.offY, pm.basePos.z + phoneAdj.offZ);
				pm.mesh.scale.set(pm.baseScale.x * phoneAdj.scale, pm.baseScale.y * phoneAdj.scale, pm.baseScale.z * phoneAdj.scale);
			}
		};
		if (typeof window !== "undefined") {
			(window as unknown as Record<string, unknown>).__phoneAdj = (o: Partial<typeof phoneAdj>) => {
				Object.assign(phoneAdj, o);
				applyPhoneTransform();
			};
		}

		const applyPose = () => {
			if (!ready) return;
			pull.rotation.set(0, pose.bodyYaw, 0);
			setArm("armL", "forearmL", 1, pose.armL);
			setArm("armR", "forearmR", -1, pose.armR);
			setBone("head", pose.head.pitch, pose.head.yaw, pose.head.roll);
			setBone("waist", pose.waist.x, 0, pose.waist.z);
			setBone("spine", pose.spine.x, 0, pose.spine.z);
			setBone("thighL", 0, 0, pose.legs.thighL);
			setBone("thighR", 0, 0, pose.legs.thighR);
			setBone("calfL", pose.legs.calfL, 0, 0);
			setBone("calfR", pose.legs.calfR, 0, 0);
			if (pose.phone !== phoneShown) {
				phoneShown = pose.phone;
				cos?.setVisible("phone", pose.phone);
			}
		};

		let raf = 0;
		const animate = () => {
			raf = requestAnimationFrame(animate);
			applyPose();
			controls.update();
			renderer.render(scene, camera);
		};
		animate();

		// ---- GUI ----
		const gui = new GUI({ title: "Pose Studio" });
		gui.domElement.style.maxHeight = "94vh";
		gui.domElement.style.overflowY = "auto";
		const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());

		const prop = gui.addFolder("Prop");
		prop.add(pose, "phone").name("hold phone");
		prop.add(phoneAdj, "scale", 0.6, 2.6, 0.01).name("phone scale ×").onChange(applyPhoneTransform);
		prop.add(phoneAdj, "offX", -0.4, 0.4, 0.005).name("phone off X").onChange(applyPhoneTransform);
		prop.add(phoneAdj, "offY", -0.4, 0.4, 0.005).name("phone off Y").onChange(applyPhoneTransform);
		prop.add(phoneAdj, "offZ", -0.4, 0.4, 0.005).name("phone off Z").onChange(applyPhoneTransform);

		const body = gui.addFolder("Body / Head");
		body.add(pose, "bodyYaw", -1.6, 1.6, 0.01).name("body yaw");
		body.add(pose.head, "pitch", -1.2, 1.2, 0.01).name("head pitch");
		body.add(pose.head, "yaw", -1.2, 1.2, 0.01).name("head yaw");
		body.add(pose.head, "roll", -1.0, 1.0, 0.01).name("head roll");

		const armFolder = (title: string, a: ArmPose) => {
			const f = gui.addFolder(title);
			f.add(a, "swingX", -1.6, 2.2, 0.01).name("swing X (fwd)");
			f.add(a, "swingZ", -3.2, 3.2, 0.01).name("swing Z (down/side)");
			f.add(a, "twist", -2.0, 2.0, 0.01).name("twist / roll");
			f.add(a, "foreX", -2.6, 1.0, 0.01).name("elbow bend X");
			f.add(a, "foreZ", -1.6, 1.6, 0.01).name("elbow bend Z");
			return f;
		};
		armFolder("Left Arm", pose.armL);
		armFolder("Right Arm (phone)", pose.armR);

		const torso = gui.addFolder("Torso / Legs");
		torso.close();
		torso.add(pose.waist, "x", -1.0, 1.0, 0.01).name("waist bend X");
		torso.add(pose.waist, "z", -1.0, 1.0, 0.01).name("waist bend Z");
		torso.add(pose.spine, "x", -1.0, 1.0, 0.01).name("spine bend X");
		torso.add(pose.spine, "z", -1.0, 1.0, 0.01).name("spine bend Z");
		torso.add(pose.legs, "thighL", -1.0, 1.0, 0.01).name("L thigh");
		torso.add(pose.legs, "thighR", -1.0, 1.0, 0.01).name("R thigh");
		torso.add(pose.legs, "calfL", -1.6, 0.4, 0.01).name("L calf");
		torso.add(pose.legs, "calfR", -1.6, 0.4, 0.01).name("R calf");

		// Deep-assign INTO the live pose (never replace nested objects) so the GUI
		// controllers — bound to pose.armL / pose.head / … by reference — stay wired.
		const assignInto = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
			for (const k of Object.keys(src)) {
				const v = src[k];
				if (v && typeof v === "object") assignInto(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
				else dst[k] = v;
			}
		};
		const setPose = (p: Pose) => {
			assignInto(pose as unknown as Record<string, unknown>, clone(p) as unknown as Record<string, unknown>);
			refresh();
		};

		const presets = gui.addFolder("Presets");
		presets.add({ f: () => setPose(idle) }, "f").name("↺ reset to idle");
		presets.add({ f: () => setPose(PHONE_HOLD) }, "f").name("📱 phone-hold (shipped)");

		// ---- library (save / load / delete named poses) ----
		const lib = gui.addFolder("Library");
		const state = { name: "", selected: "" };
		const flash = (m: string) => {
			setToast(m);
			window.setTimeout(() => setToast(""), 1800);
		};

		let selCtl: ReturnType<typeof lib.add> | null = null;
		const rebuildSelect = () => {
			const names = Object.keys(loadPoses());
			if (!state.selected || !names.includes(state.selected)) state.selected = names[0] ?? "";
			if (selCtl) selCtl.destroy();
			selCtl = lib.add(state, "selected", names.length ? names : ["— none —"]).name("saved pose");
			refresh();
		};

		lib.add(state, "name").name("name");
		lib.add(
			{
				f: () => {
					const nm = state.name.trim();
					if (!nm) return flash("enter a name first");
					const all = loadPoses();
					all[nm] = clone(pose);
					savePoses(all);
					state.selected = nm;
					rebuildSelect();
					flash(`saved “${nm}”`);
				},
			},
			"f",
		).name("💾 save pose");
		lib.add(
			{
				f: () => {
					const all = loadPoses();
					const p = all[state.selected];
					if (!p) return flash("nothing to load");
					setPose(p);
					flash(`loaded “${state.selected}”`);
				},
			},
			"f",
		).name("📂 load selected");
		lib.add(
			{
				f: () => {
					const all = loadPoses();
					if (!all[state.selected]) return;
					delete all[state.selected];
					savePoses(all);
					rebuildSelect();
					flash("deleted");
				},
			},
			"f",
		).name("🗑 delete selected");
		rebuildSelect();

		// ---- export ----
		const armLit = (a: ArmPose) =>
			`{ swingX: ${r3(a.swingX)}, swingZ: ${r3(a.swingZ)}, foreX: ${r3(a.foreX)}, twist: ${r3(a.twist)} }` +
			(a.foreZ ? ` /* foreZ: ${r3(a.foreZ)} */` : "");
		const copy = (text: string, label: string) => {
			navigator.clipboard?.writeText(text).then(
				() => flash(`copied ${label}`),
				() => flash("clipboard blocked"),
			);
		};
		const exp = gui.addFolder("Export");
		exp.add(
			{
				f: () => {
					const text =
						`const PHONE_R = ${armLit(pose.armR)};\n` +
						`const PHONE_L = ${armLit(pose.armL)};\n` +
						`const PHONE_POSE = { headPitch: ${r3(pose.head.pitch)}, headYaw: ${r3(pose.head.yaw)}, bodyYaw: ${r3(pose.bodyYaw)} };`;
					copy(text, "PHONE_* constants");
				},
			},
			"f",
		).name("⧉ copy PHONE_* constants");
		exp.add({ f: () => copy(JSON.stringify(pose, null, 2), "pose JSON") }, "f").name("⧉ copy full JSON");

		// ---- resize ----
		const onResize = () => {
			const w = mount.clientWidth;
			const h = mount.clientHeight;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		};
		window.addEventListener("resize", onResize);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			gui.destroy();
			controls.dispose();
			renderer.dispose();
			pmrem.dispose();
			if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
		};
	}, []);

	return (
		<div className="relative h-[100svh] w-full overflow-hidden bg-black">
			<div ref={mountRef} className="absolute inset-0" />
			{status ? (
				<div className="absolute left-3 top-3 rounded bg-black/60 px-3 py-1.5 text-sm text-white">{status}</div>
			) : null}
			<div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/55 px-3 py-1.5 text-xs text-white/80">
				drag to orbit · scroll to zoom · sliders on the right · save to your pose library
			</div>
			{toast ? (
				<div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white/95 px-4 py-1.5 text-sm font-medium text-black shadow">
					{toast}
				</div>
			) : null}
		</div>
	);
}
