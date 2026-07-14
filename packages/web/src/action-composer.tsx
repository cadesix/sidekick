import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadSettings } from "./components/sidekick-settings";
import { MODEL_URL, makeCharacterMaterials, makeOutlineMaterial, type TexSet } from "./components/sidekick-shading";
import {
	EYES_SPLIT,
	FACE_CELLS,
	FACE_EXPRESSIONS,
	FACE_SHEET_URL,
	GRID,
	createFaceController,
	loadFaceTexture,
	type FaceController,
	type FaceExpression,
} from "./components/sidekick-face";

// Dev-only Action Composer (/action-composer): every armature animation preset
// playable side by side with full face control — base expression, talking
// flaps, auto-blink, and MANUAL eye/mouth band overrides (the two bands sample
// independently since the face-split shader). The right rail shows the sprite
// sheet AS IT RENDERS: each cell cropped to its sampling window and disc, the
// eyes/mouth split line, and live highlights of which cells each band is
// showing — the place to spot sheet issues.

const BONE_MAP = {
	waist: "Waist",
	spine: "Spine01",
	head: "Head",
	armL: "L_Upperarm",
	armR: "R_Upperarm",
	forearmL: "L_Forearm",
	forearmR: "R_Forearm",
	thighL: "L_Thigh",
	thighR: "R_Thigh",
	calfL: "L_Calf",
	calfR: "R_Calf",
} as const;
type BoneName = keyof typeof BONE_MAP;

type ClipName = "idle" | "wave" | "jump" | "cheer" | "dance";
const CLIPS: ClipName[] = ["idle", "wave", "jump", "cheer", "dance"];
const CLIP_DURATION: Record<ClipName, number> = { idle: Infinity, wave: 2.2, jump: 1.0, cheer: 2.4, dance: 3.2 };
const ARM_DOWN = 1.15;

export default function ActionComposer() {
	const mountRef = useRef<HTMLDivElement>(null);
	const playRef = useRef<(c: ClipName) => void>(() => {});
	const faceRef = useRef<FaceController | null>(null);
	const [status, setStatus] = useState("loading…");
	const [clip, setClip] = useState<ClipName>("idle");
	const [expr, setExpr] = useState<FaceExpression>("neutral");
	const [eyesOv, setEyesOv] = useState<FaceExpression | "">("");
	const [mouthOv, setMouthOv] = useState<FaceExpression | "">("");
	const [talking, setTalking] = useState(false);
	const [autoBlink, setAutoBlink] = useState(true);
	const [zoom, setZoom] = useState(() => loadSettings().faceZoom);
	const [height, setHeight] = useState(() => loadSettings().faceHeight);
	const [bands, setBands] = useState<{ eyes: FaceExpression; mouth: FaceExpression }>({ eyes: "neutral", mouth: "neutral" });

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		// StrictMode (dev) mounts→cleans→remounts; async loader callbacks from the
		// dead first run must not publish controllers/meshes into the live run
		let cancelled = false;
		const s = loadSettings();
		const scene = new THREE.Scene();
		scene.background = new THREE.Color("#ece4d4");
		const camera = new THREE.PerspectiveCamera(35, mount.clientWidth / mount.clientHeight, 0.1, 50);
		camera.position.set(0, 0.72, 2.7);
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		mount.appendChild(renderer.domElement);
		scene.add(new THREE.HemisphereLight("#ffffff", "#c8cbd8", 0.85));
		const key = new THREE.DirectionalLight("#fff4dc", 1.5);
		key.position.set(3, 4, 3);
		scene.add(key);
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 0.55, 0);
		controls.enableDamping = true;

		const rig = new THREE.Group();
		rig.rotation.y = -Math.PI / 2; // model faces +X raw
		scene.add(rig);
		const bones = {} as Record<BoneName, THREE.Bone>;
		const rest = {} as Record<BoneName, THREE.Quaternion>;
		let faceCtl: FaceController | null = null;
		let ready = false;

		new GLTFLoader().load(
			MODEL_URL,
			(gltf) => {
				if (cancelled) return;
				const model = gltf.scene;
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
				// normalize: feet on the ground, 1 unit tall, centered
				const box = new THREE.Box3().setFromObject(model);
				const scl = 1 / (box.max.y - box.min.y);
				model.scale.setScalar(scl);
				const center = box.getCenter(new THREE.Vector3());
				model.position.set(-center.x * scl, -box.min.y * scl, -center.z * scl);
				rig.add(model);

				loadFaceTexture((t) => {
					if (cancelled) return;
					if (t) {
						faceCtl = createFaceController(t, s.faceZoom, s.faceHeight);
						faceRef.current = faceCtl;
						// ?expr=surprised deep-links an expression (and scripted probes)
						const q = new URLSearchParams(window.location.search).get("expr") as FaceExpression | null;
						if (q && q in FACE_CELLS) {
							faceCtl.set(q);
							setExpr(q);
						}
					}
					const mats = makeCharacterMaterials(s, texSet, null, t);
					if (bodyMesh) bodyMesh.material = mats.body;
					if (faceMesh) faceMesh.material = mats.face;
					if (bodyMesh && s.outline) {
						const b = bodyMesh as THREE.SkinnedMesh;
						const outline = new THREE.SkinnedMesh(b.geometry, makeOutlineMaterial(s));
						outline.bind(b.skeleton, b.bindMatrix);
						outline.frustumCulled = false;
						b.parent!.add(outline);
					}
					setStatus("");
				});

				for (const [ours, theirs] of Object.entries(BONE_MAP)) {
					const bone = model.getObjectByName(theirs);
					if (!(bone instanceof THREE.Bone)) {
						setStatus(`bone not found: ${theirs}`);
						return;
					}
					bones[ours as BoneName] = bone;
					rest[ours as BoneName] = bone.quaternion.clone();
				}
				ready = true;
			},
			undefined,
			(err) => setStatus(`load failed: ${String(err)}`),
		);

		// --- clip math (same conventions as /sidekick-3d) ---
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
			const split = s.poseRollSplit;
			qSwing.setFromEuler(e.set(swing.x, 0, swing.z));
			armAxis.set(side, 0, 0).applyQuaternion(qSwing);
			qRoll.setFromAxisAngle(armAxis, swing.roll * split);
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(arm, qArm);
			qSwing.setFromEuler(e.set(fore.x, 0, fore.z));
			qRoll.setFromAxisAngle(armAxis, swing.roll * (1 - split));
			qArm.copy(qRoll).multiply(qSwing);
			setBoneQ(forearm, qArm);
		};
		const env = (t: number, dur: number) =>
			THREE.MathUtils.clamp(t / 0.25, 0, 1) * THREE.MathUtils.clamp((dur - t) / 0.3, 0, 1);

		let cur: ClipName = "idle";
		let clipStart = 0;
		const clock = new THREE.Clock();
		playRef.current = (c) => {
			cur = c;
			clipStart = clock.getElapsedTime();
			setClip(c);
		};

		let raf = 0;
		const lerp = THREE.MathUtils.lerp;
		const animate = () => {
			raf = requestAnimationFrame(animate);
			const now = clock.getElapsedTime();
			if (ready) {
				const t = now - clipStart;
				if (t > CLIP_DURATION[cur]) {
					cur = "idle";
					setClip("idle");
				}
				const breath = 1 + Math.sin(now * 2.2) * 0.012;
				rig.scale.set(1 / Math.sqrt(breath), breath, 1 / Math.sqrt(breath));
				rig.position.y = 0;
				const sway = Math.sin(now * 2.2) * 0.04;
				let armLz = -s.poseArmDown + sway;
				let armRz = s.poseArmDown - sway;
				const armLx = s.poseArmForward;
				const armRx = s.poseArmForward;
				let armLy = s.poseArmTwist;
				let armRy = -s.poseArmTwist;
				let foreLx = s.poseForeBend;
				let foreRx = s.poseForeBend;
				let foreLz = 0;
				let foreRz = 0;
				let headX = 0;
				let headZ = 0;
				let waistY = 0;
				let spineY = 0;
				let spineZ = 0;

				if (cur === "wave") {
					const a = env(t, CLIP_DURATION.wave);
					armRz = lerp(armRz, -0.6, a);
					armRy = lerp(armRy, 0, a);
					foreRx = lerp(foreRx, 0, a);
					foreRz = lerp(foreRz, -0.45 - 0.45 * Math.sin(t * 11), a);
					headZ += a * 0.12;
				} else if (cur === "jump") {
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
				} else if (cur === "cheer") {
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
				} else if (cur === "dance") {
					const a = env(t, CLIP_DURATION.dance);
					waistY = a * 0.35 * Math.sin(t * 6);
					spineY = -a * 0.2 * Math.sin(t * 6);
					spineZ = a * 0.08 * Math.sin(t * 3);
					armLz = lerp(armLz, -ARM_DOWN + 0.9 + 0.5 * Math.sin(t * 6), a);
					armRz = lerp(armRz, ARM_DOWN - 0.9 - 0.5 * Math.sin(t * 6 + Math.PI), a);
					armLy = lerp(armLy, 0.5 * s.poseArmTwist, a);
					armRy = lerp(armRy, -0.5 * s.poseArmTwist, a);
					foreLx = lerp(foreLx, -0.5, a);
					foreRx = lerp(foreRx, -0.5, a);
					headZ = a * 0.15 * Math.sin(t * 6 + 1);
					rig.position.y = a * 0.04 * Math.abs(Math.sin(t * 6));
				}

				setBone("waist", 0, waistY, 0);
				setBone("spine", 0, spineY, spineZ);
				setBone("head", headX, 0, headZ);
				setArm("armL", "forearmL", 1, { x: armLx, z: armLz, roll: armLy }, { x: foreLx, z: foreLz });
				setArm("armR", "forearmR", -1, { x: armRx, z: armRz, roll: armRy }, { x: foreRx, z: foreRz });
			}
			faceCtl?.update(now);
			controls.update();
			renderer.render(scene, camera);
		};
		animate();

		// mirror band state into React for the inspector highlights
		const poll = window.setInterval(() => {
			const st = faceCtl?.getState();
			if (st) setBands((prev) => (prev.eyes === st.eyes && prev.mouth === st.mouth ? prev : st));
		}, 120);

		const onResize = () => {
			camera.aspect = mount.clientWidth / mount.clientHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(mount.clientWidth, mount.clientHeight);
		};
		window.addEventListener("resize", onResize);
		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
			window.clearInterval(poll);
			window.removeEventListener("resize", onResize);
			controls.dispose();
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// --- inspector helpers: a cell cropped exactly as the shader samples it ---
	const winFrac = 1 / (GRID * Math.max(0.9, zoom));
	const cellPreview = (exprName: FaceExpression, sizePx: number) => {
		const [c, r] = FACE_CELLS[exprName];
		const cell = 1 / GRID;
		const inset = (cell - winFrac) / 2;
		const u = c * cell + inset;
		const v = r * cell + inset + height * cell;
		const imgSize = sizePx / winFrac;
		return {
			backgroundImage: `url(${FACE_SHEET_URL})`,
			backgroundSize: `${imgSize}px ${imgSize}px`,
			backgroundPosition: `${-u * imgSize}px ${-v * imgSize}px`,
		};
	};

	const btn = (active: boolean) =>
		`rounded-full px-3 py-1.5 text-[13px] font-bold transition ${
			active ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 active:bg-neutral-200"
		}`;

	return (
		<div className="flex h-screen bg-neutral-50">
			{/* stage */}
			<div className="relative min-w-0 flex-1">
				<div ref={mountRef} className="h-full w-full" />
				<div className="absolute left-4 top-4 rounded-lg bg-white/85 px-3 py-2 text-sm shadow">
					<div className="font-bold text-neutral-900">Action Composer</div>
					<div className="text-xs text-neutral-500">{status || "drag to orbit"}</div>
				</div>
			</div>

			{/* controls + sheet inspector */}
			<div className="no-scrollbar w-[440px] shrink-0 overflow-y-auto border-l border-black/10 bg-white p-5">
				<div className="text-[13px] font-semibold uppercase tracking-wide text-neutral-400">Animations</div>
				<div className="mt-2 flex flex-wrap gap-2">
					{CLIPS.map((c) => (
						<button key={c} className={btn(clip === c)} onClick={() => playRef.current(c)}>
							{c}
						</button>
					))}
				</div>

				<div className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">Expression (both bands)</div>
				<div className="mt-2 flex flex-wrap gap-2">
					{FACE_EXPRESSIONS.map((x) => (
						<button
							key={x}
							className={btn(expr === x)}
							onClick={() => {
								setExpr(x);
								faceRef.current?.set(x);
							}}
						>
							{x}
						</button>
					))}
				</div>

				<div className="mt-6 grid grid-cols-2 gap-4">
					<label className="block">
						<div className="text-[13px] font-semibold uppercase tracking-wide text-neutral-400">Eyes override</div>
						<select
							value={eyesOv}
							onChange={(ev) => {
								const v = ev.target.value as FaceExpression | "";
								setEyesOv(v);
								faceRef.current?.setEyesOverride(v === "" ? null : v);
							}}
							className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5 text-[13px]"
						>
							<option value="">(follow expression)</option>
							{FACE_EXPRESSIONS.map((x) => (
								<option key={x} value={x}>
									{x}
								</option>
							))}
						</select>
					</label>
					<label className="block">
						<div className="text-[13px] font-semibold uppercase tracking-wide text-neutral-400">Mouth override</div>
						<select
							value={mouthOv}
							onChange={(ev) => {
								const v = ev.target.value as FaceExpression | "";
								setMouthOv(v);
								faceRef.current?.setMouthOverride(v === "" ? null : v);
							}}
							className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5 text-[13px]"
						>
							<option value="">(follow expression)</option>
							{FACE_EXPRESSIONS.map((x) => (
								<option key={x} value={x}>
									{x}
								</option>
							))}
						</select>
					</label>
				</div>

				<div className="mt-4 flex flex-wrap items-center gap-4">
					<label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-700">
						<input
							type="checkbox"
							checked={talking}
							onChange={(ev) => {
								setTalking(ev.target.checked);
								faceRef.current?.setTalking(ev.target.checked);
							}}
						/>
						talking
					</label>
					<label className="flex items-center gap-1.5 text-[13px] font-semibold text-neutral-700">
						<input
							type="checkbox"
							checked={autoBlink}
							onChange={(ev) => {
								setAutoBlink(ev.target.checked);
								faceRef.current?.setBlinking(ev.target.checked);
							}}
						/>
						auto-blink
					</label>
					<button
						className={btn(false)}
						onClick={() => {
							faceRef.current?.setEyesOverride("blink");
							window.setTimeout(() => faceRef.current?.setEyesOverride(eyesOv === "" ? null : eyesOv), 160);
						}}
					>
						blink once
					</button>
				</div>

				<div className="mt-4 grid grid-cols-2 gap-4">
					<label className="block text-[13px] font-semibold text-neutral-700">
						face zoom {zoom.toFixed(2)}
						<input
							type="range"
							min={0.9}
							max={2}
							step={0.01}
							value={zoom}
							onChange={(ev) => {
								const v = Number(ev.target.value);
								setZoom(v);
								faceRef.current?.setScale(v);
							}}
							className="w-full"
						/>
					</label>
					<label className="block text-[13px] font-semibold text-neutral-700">
						face height {height.toFixed(3)}
						<input
							type="range"
							min={-0.1}
							max={0.1}
							step={0.005}
							value={height}
							onChange={(ev) => {
								const v = Number(ev.target.value);
								setHeight(v);
								faceRef.current?.setOffsetY(v);
							}}
							className="w-full"
						/>
					</label>
				</div>

				{/* the sheet AS RENDERED: window-cropped, disc-clipped, split-marked */}
				<div className="mt-8 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">
					Sheet · as rendered on the face
				</div>
				<div className="mt-1 text-[12px] text-neutral-400">
					circle = disc crop · dashed = eyes/mouth split · blue ring = eye band · pink ring = mouth band
				</div>
				<div className="mt-3 grid grid-cols-4 gap-3">
					{FACE_EXPRESSIONS.map((x) => {
						const isEyes = bands.eyes === x;
						const isMouth = bands.mouth === x;
						return (
							<div key={x} className="text-center">
								<div
									className={`relative mx-auto h-[84px] w-[84px] overflow-hidden rounded-full bg-[#f2b13c] ring-2 ${
										isEyes && isMouth
											? "ring-violet-500"
											: isEyes
												? "ring-sky-500"
												: isMouth
													? "ring-pink-500"
													: "ring-black/10"
									}`}
									style={cellPreview(x, 84)}
								>
									<div
										className="absolute inset-x-0 border-t border-dashed border-black/30"
										style={{ top: `${EYES_SPLIT * 100}%` }}
									/>
								</div>
								<div className="mt-1 truncate text-[11px] font-semibold text-neutral-600">{x}</div>
							</div>
						);
					})}
				</div>

				{/* full sheet with the grid, for raw art inspection */}
				<div className="mt-8 text-[13px] font-semibold uppercase tracking-wide text-neutral-400">Full sheet</div>
				<div className="relative mt-3">
					<img src={FACE_SHEET_URL} alt="face sheet" className="w-full rounded-lg bg-[#f2b13c]" draggable={false} />
					{Array.from({ length: 3 }, (_, i) => (
						<div key={`v${i}`} className="absolute inset-y-0 border-l border-black/20" style={{ left: `${(i + 1) * 25}%` }} />
					))}
					{Array.from({ length: 3 }, (_, i) => (
						<div key={`h${i}`} className="absolute inset-x-0 border-t border-black/20" style={{ top: `${(i + 1) * 25}%` }} />
					))}
				</div>
			</div>
		</div>
	);
}
