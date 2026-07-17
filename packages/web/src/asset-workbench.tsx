import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
	createCosmetics,
	type CosmeticsHandle,
	type SlotDef,
} from "./components/sidekick-equipment";
import { loadFaceTexture } from "./components/sidekick-face";
import { loadSettings, type SidekickSettings } from "./components/sidekick-settings";
import {
	MODEL_URL,
	makeCelMaterial,
	makeCharacterMaterials,
	type TexSet,
} from "./components/sidekick-shading";
import { makeSkinMaterial, type MaterialParams } from "./components/skin-material";
import { SHOP_COLORS } from "./components/sidekick-wardrobe";

// The Asset Manager's 3D workbench (clicked into from the catalog view in
// asset-manager.tsx). Loads the rigged character and lets you iterate on one
// asset at a time: equip any item/variant/color on the live rig (rendered
// through the exact in-game material pipeline), orbit-inspect it, hide the
// body to see the item's worn shape, and live-tune a rigid item's manifest
// `scale`/`offset`/`rotate` with copy/save buttons that emit the JSON patch or
// write it straight into cosmetics/manifest.json.

export type ItemDef = SlotDef & { slot?: string };
export type ItemManifest = Record<string, ItemDef>;
type WornState = Record<string, { variantId: string; color?: string }>;
// one entry in the curated shop catalog (shop-catalog.json), keyed by renderKey
type CatalogEntry = { renderKey: string; slot: string; variantId?: string; color?: string };

// A complete, packaged base-character "material": everything that defines a look
// — flat color OR texture, the cel tuning, transparency, and the shader effect
// stack — in one curatable, shippable unit. Authored in public/cosmetics/materials.json.
// The look is always built on the cel core, so cel integrity holds regardless.
type Material = {
	id: string;
	name: string;
	shipped?: boolean; // curation: does this material ship to the product?
	bodyColor: string; // flat albedo (used when there's no tex)
	shadowColor: string; // cel shadow tint (day scene shadeColor override)
	shadowAmt: number; // celShadowAmt 0..1
	softness: number; // celSoftness 0..1
	rimColor: string;
	rimStrength: number; // 0 = no rim
	rimWidth: number; // 0..0.6
	tex?: string | null; // generated albedo texture URL; absent/null = solid bodyColor
	texRepeat?: number; // tiling (default 1)
	opacity?: number; // transparency: 1 = opaque (default), <1 = see-through
	fx?: MaterialParams; // shader effect stack (iridescence/spec/velvet/emissive/rim)
};
const SKIN_KEY = "__skin__"; // sentinel `selected` value for the material editor

// An "outfit" (kit): an optional base material + a set of cosmetic parts equipped
// together. material:null = pure costume (keeps the current skin, e.g. Dino);
// material set = the body becomes something (e.g. Cactus). Authored in outfits.json.
type Outfit = {
	id: string;
	name: string;
	material: string | null; // material id, or null to keep the current skin
	parts: { item: string; variantId?: string }[];
	note?: string;
};

type Rig = {
	cos: CosmeticsHandle;
	setBodyVisible: (on: boolean) => void;
	frame: (targets: THREE.Object3D[] | null) => void;
	// rebuild the body/face materials for a complete material (color/tex/opacity/fx)
	applyMaterial: (mat: Material) => void;
};

// items sharing an effective slot are mutually exclusive (SHOP-NOTES.md)
export const effSlot = (key: string, def: ItemDef) => def.slot ?? key;

// a rigid item's manifest tuning as a plain triple (mirrors attachRigid's inputs)
type Tuning = { scale: number; offset: [number, number, number]; rotate: [number, number, number] };
const DEG = Math.PI / 180;
const quatFromDeg = (r: [number, number, number]) =>
	new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG));

export const base = (path?: string) => path?.split("/").pop() ?? "";

// one tuning dimension: slider + exact number input + reset-to-default
function TuneRow({
	label,
	value,
	fallback,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	value: number;
	fallback: number; // the neutral default the reset button restores
	min: number;
	max: number;
	step: number;
	onChange: (v: number) => void;
}) {
	return (
		<label className="mb-2 block text-xs text-neutral-400">
			<span className="flex items-center gap-1.5">
				<span className="flex-1">{label}</span>
				<input
					type="number"
					min={min}
					max={max}
					step={step}
					value={value}
					className="w-16 rounded border border-white/15 bg-neutral-900 px-1 py-0.5 text-right text-[11px] text-neutral-200 [appearance:textfield]"
					onChange={(e) => {
						const v = Number(e.target.value);
						if (Number.isFinite(v)) onChange(v);
					}}
				/>
				<button
					type="button"
					title={`reset to ${fallback}`}
					disabled={value === fallback}
					className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-white/5 disabled:opacity-30"
					onClick={() => onChange(fallback)}
				>
					↺
				</button>
			</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				className="mt-1 w-full"
				onChange={(e) => onChange(Number(e.target.value))}
			/>
		</label>
	);
}

export function AssetWorkbench({ item, onBack }: { item: string | null; onBack: () => void }) {
	const mountRef = useRef<HTMLDivElement>(null);
	// serializes equip/unequip/re-tune against the async cosmetics API
	const opRef = useRef<Promise<void>>(Promise.resolve());
	const openedRef = useRef(false);
	const [rig, setRig] = useState<Rig | null>(null);
	const [manifest, setManifest] = useState<ItemManifest | null>(null);
	const [worn, setWorn] = useState<WornState>({});
	const [selected, setSelected] = useState<string | null>(item);
	const [bodyOn, setBodyOn] = useState(true);
	const [status, setStatus] = useState("loading character…");
	const [copied, setCopied] = useState(false);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	// the curated shop catalog (shop-catalog.json in core) — full entries so the
	// catalog modal can render each; membership is derived as a renderKey set
	const [catEntries, setCatEntries] = useState<CatalogEntry[]>([]);
	const [catState, setCatState] = useState<"idle" | "saving" | "error">("idle");
	const [catOpen, setCatOpen] = useState(false);
	const catalog = useMemo(() => new Set(catEntries.map((e) => e.renderKey)), [catEntries]);
	// the complete, curated material library (public/cosmetics/materials.json)
	const [materials, setMaterials] = useState<Material[]>([]);
	const [activeMatId, setActiveMatId] = useState<string | null>(null);
	const [matSaveState, setMatSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	// outfits (kits): equip a bundled material + parts (dino/cactus prototype)
	const [outfits, setOutfits] = useState<Outfit[]>([]);
	const [activeOutfitId, setActiveOutfitId] = useState<string | null>(null);
	// Blender-style transform gizmo (rigid items only): T=move, R=rotate, S=scale
	const [gizmoOn, setGizmoOn] = useState(false);
	const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate" | "scale">("translate");
	const transformRef = useRef<TransformControls | null>(null);
	const proxyRef = useRef<THREE.Object3D | null>(null);
	// per-target-mesh authored base (transform BEFORE def), captured at drag start,
	// so we can reproduce attachRigid's math live without a per-frame re-equip
	const authoredRef = useRef<
		{ mesh: THREE.Mesh; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }[]
	>([]);
	// fresh state for the gizmo's (mount-effect) event handlers, dodging stale closures
	const ctxRef = useRef<{ selected: string | null; worn: WornState; rig: Rig | null }>({
		selected: null,
		worn: {},
		rig: null,
	});
	ctxRef.current = { selected, worn, rig };

	const run = (fn: () => Promise<void> | void) => {
		opRef.current = opRef.current.then(fn).catch((e) => console.error("[asset-manager]", e));
	};

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		let cancelled = false;
		let raf = 0;
		let cos: CosmeticsHandle | null = null;

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(
			30,
			mount.clientWidth / Math.max(mount.clientHeight, 1),
			0.01,
			60,
		);
		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setSize(mount.clientWidth, mount.clientHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setClearColor(0x000000, 0);
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		mount.appendChild(renderer.domElement);
		// neutral daylight, same setup as the turntable/product renders
		scene.add(new THREE.HemisphereLight("#ffffff", "#c8cbd8", 0.9));
		const key = new THREE.DirectionalLight("#fff4dc", 1.6);
		key.position.set(3, 4, 3);
		scene.add(key);
		const fill = new THREE.DirectionalLight("#a9c9ff", 0.55);
		fill.position.set(-3, 1, 2);
		scene.add(fill);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;

		// ---- Blender-style transform gizmo -------------------------------------
		// Drives a proxy Object3D parented under the item's attach bone; the proxy's
		// bone-local TRS maps 1:1 to the manifest's offset/rotate/scale. Live drag
		// reproduces attachRigid's math on the equipped meshes directly (no re-equip).
		const curDef = (): ItemDef | null => {
			const { selected, rig } = ctxRef.current;
			return selected && rig ? (rig.cos.slots()[selected] as ItemDef) : null;
		};
		const applyDefLive = (d: Tuning) => {
			const R = quatFromDeg(d.rotate);
			const off = new THREE.Vector3(...d.offset);
			for (const a of authoredRef.current) {
				a.mesh.scale.copy(a.scale).multiplyScalar(d.scale);
				a.mesh.quaternion.copy(R).multiply(a.quat);
				a.mesh.position.copy(a.pos).applyQuaternion(R).add(off);
			}
		};
		const onGizmoStart = () => {
			const def = curDef();
			const { rig } = ctxRef.current;
			if (!def || !rig) return;
			// back the authored base out of each live mesh using the CURRENT def
			const s0 = def.scale ?? 1;
			const R0inv = quatFromDeg(def.rotate ?? [0, 0, 0]).invert();
			const off0 = new THREE.Vector3(...(def.offset ?? [0, 0, 0]));
			authoredRef.current = rig.cos
				.targets()
				.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh)
				.map((m) => ({
					mesh: m,
					scale: m.scale.clone().divideScalar(s0 || 1),
					quat: R0inv.clone().multiply(m.quaternion),
					pos: m.position.clone().sub(off0).applyQuaternion(R0inv),
				}));
		};
		const onGizmoChange = () => {
			const proxy = proxyRef.current;
			const def = curDef();
			if (!proxy || !def || !authoredRef.current.length) return;
			const s = (proxy.scale.x + proxy.scale.y + proxy.scale.z) / 3; // force uniform
			proxy.scale.setScalar(s);
			const d: Tuning = {
				offset: [proxy.position.x, proxy.position.y, proxy.position.z],
				rotate: [proxy.rotation.x / DEG, proxy.rotation.y / DEG, proxy.rotation.z / DEG],
				scale: s,
			};
			def.scale = d.scale;
			def.offset = d.offset;
			def.rotate = d.rotate;
			applyDefLive(d);
		};
		const onGizmoEnd = () => {
			const { rig } = ctxRef.current;
			if (rig) setManifest({ ...(rig.cos.slots() as ItemManifest) }); // sync sliders + save
		};
		const transform = new TransformControls(camera, renderer.domElement);
		transform.setMode("translate");
		transform.setSpace("local");
		// click-to-select bookkeeping: a tap that interacted with the gizmo (or was
		// really an orbit drag) must NOT be read as a select/deselect click
		let downX = 0;
		let downY = 0;
		let overGizmo = false;
		let draggedGizmo = false;
		transform.addEventListener("dragging-changed", (e) => {
			controls.enabled = !e.value;
			if (e.value) {
				draggedGizmo = true;
				onGizmoStart();
			} else onGizmoEnd();
		});
		transform.addEventListener("objectChange", onGizmoChange);
		scene.add(transform.getHelper());
		transformRef.current = transform;

		// Click the item in the viewport → gizmo on; click empty space → gizmo off.
		// A tap is a pointerup with almost no movement that didn't touch the gizmo.
		const raycaster = new THREE.Raycaster();
		const ndc = new THREE.Vector2();
		const onPointerDown = (e: PointerEvent) => {
			downX = e.clientX;
			downY = e.clientY;
			overGizmo = transform.axis !== null; // pressed on a gizmo handle
		};
		const onPointerUp = (e: PointerEvent) => {
			if (draggedGizmo) {
				draggedGizmo = false;
				return;
			}
			if (overGizmo) {
				overGizmo = false;
				return;
			}
			if ((e.clientX - downX) ** 2 + (e.clientY - downY) ** 2 > 36) return; // dragged (orbit), not a tap
			const { rig, selected } = ctxRef.current;
			if (!rig) return;
			const rect = renderer.domElement.getBoundingClientRect();
			ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
			ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(ndc, camera);
			const hitItem = raycaster.intersectObjects(rig.cos.targets(), true).length > 0;
			if (hitItem) {
				const def = selected ? (rig.cos.slots()[selected] as ItemDef) : null;
				if (def && def.attach !== "skinned") setGizmoOn(true); // rigid items only
			} else {
				setGizmoOn(false);
			}
		};
		renderer.domElement.addEventListener("pointerdown", onPointerDown);
		renderer.domElement.addEventListener("pointerup", onPointerUp);

		// keyboard: T = translate, R = rotate, S = scale (ignored while typing)
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			const mode = e.key === "t" ? "translate" : e.key === "r" ? "rotate" : e.key === "s" ? "scale" : null;
			if (!mode) return;
			transform.setMode(mode);
			setGizmoMode(mode);
		};
		window.addEventListener("keydown", onKey);

		const onResize = () => {
			const w = mount.clientWidth;
			const h = Math.max(mount.clientHeight, 1);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		};
		window.addEventListener("resize", onResize);

		(async () => {
			const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
			if (cancelled) return;
			const model = gltf.scene;
			scene.add(model);
			let body: THREE.SkinnedMesh | null = null;
			let faceMesh: THREE.SkinnedMesh | null = null;
			let texSet: TexSet | null = null;
			const charMeshes: THREE.Mesh[] = [];
			model.traverse((c) => {
				if (c instanceof THREE.SkinnedMesh) {
					charMeshes.push(c);
					c.frustumCulled = false;
					// the textured mesh is the body; the untextured one is the face plane
					const orig = c.material as THREE.MeshStandardMaterial;
					if (orig.map) {
						body = c;
						texSet = { map: orig.map, normalMap: null, vertexColors: !!c.geometry.attributes.color };
					} else {
						faceMesh = c;
					}
				}
			});
			if (!body) {
				setStatus("no textured body mesh in GLB");
				return;
			}
			// present assets in neutral day light (the active preset may live in
			// evening, whose warm tint distorts item colors)
			const settings: SidekickSettings = { ...loadSettings(), timeOfDay: "day" };
			// cel-shade the body + face exactly like the main web views (character-preview /
			// sidekick-3d): the workbench previously left the body wearing the GLB's standard
			// material, so only equipped items looked cel-shaded. makeCharacterMaterials is the
			// web app's own toon shader — same package, no cross-package porting.
			const faceTex = await new Promise<THREE.Texture | null>((r) => loadFaceTexture(r));
			if (cancelled) return;
			if (texSet) {
				const mats = makeCharacterMaterials(settings, texSet, null, faceTex);
				(body as THREE.SkinnedMesh).material = mats.body;
				if (faceMesh) (faceMesh as THREE.SkinnedMesh).material = mats.face;
			}
			cos = createCosmetics(body, settings, null);
			await cos.ready;
			if (cancelled) return;
			setManifest({ ...(cos.slots() as ItemManifest) });

			const frame = (targets: THREE.Object3D[] | null) => {
				const box = new THREE.Box3();
				if (targets?.length) for (const t of targets) box.expandByObject(t);
				else box.expandByObject(model);
				if (box.isEmpty()) return;
				const center = box.getCenter(new THREE.Vector3());
				const span = box.getSize(new THREE.Vector3()).length() || 0.2;
				const dist = (span / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.25;
				controls.target.copy(center);
				camera.position
					.copy(center)
					.add(new THREE.Vector3(1, 0.35, 1).normalize().multiplyScalar(dist));
			};
			frame(null);
			// rebuild the body + face materials for a COMPLETE material: flat color OR
			// texture, cel tuning, transparency, and the shader effect stack — all built
			// on the cel core so the cel look is preserved. The face stays the cel face.
			const bodyMesh = body as THREE.SkinnedMesh;
			const texCache = new Map<string, THREE.Texture>();
			const texLoader = new THREE.TextureLoader();
			const loadTex = (url: string) =>
				new Promise<THREE.Texture>((res, rej) => {
					const c = texCache.get(url);
					if (c) return res(c);
					texLoader.load(
						url,
						(t) => {
							t.colorSpace = THREE.SRGBColorSpace;
							t.wrapS = t.wrapT = THREE.RepeatWrapping;
							texCache.set(url, t);
							res(t);
						},
						undefined,
						rej,
					);
				});
			let matToken = 0;
			const applyMaterial = async (mat: Material) => {
				if (!texSet) return;
				const token = ++matToken;
				const sMat: SidekickSettings = {
					...settings,
					celBodyColor: mat.bodyColor,
					celShadowAmt: mat.shadowAmt,
					celSoftness: mat.softness,
					celRimColor: mat.rimColor,
					celRimStrength: mat.rimStrength,
					celRimWidth: mat.rimWidth,
					scenes: {
						...settings.scenes,
						[settings.timeOfDay]: {
							...settings.scenes[settings.timeOfDay],
							shadeColor: mat.shadowColor,
						},
					},
				};
				let map: THREE.Texture | null = null;
				if (mat.tex) {
					try {
						map = await loadTex(mat.tex);
					} catch {
						map = null;
					}
					if (token !== matToken) return; // a newer material won the race
				}
				if (map) map.repeat.set(mat.texRepeat ?? 1, mat.texRepeat ?? 1);
				const fx = mat.fx;
				const hasEffect =
					!!fx && !!(fx.irid || fx.spec || fx.velvet || fx.emissive || fx.rimBoost);
				const bodyMat = hasEffect
					? makeSkinMaterial(sMat, { params: fx as MaterialParams, color: mat.bodyColor, map })
					: map
						? makeCelMaterial(sMat, { map, normalMap: null, vertexColors: false })
						: makeCelMaterial(sMat, texSet, mat.bodyColor);
				// transparency: opacity < 1 makes the whole body see-through
				const opacity = mat.opacity ?? 1;
				if (opacity < 1) {
					bodyMat.transparent = true;
					bodyMat.opacity = opacity;
					bodyMat.depthWrite = false;
				}
				const faceMats = makeCharacterMaterials(sMat, texSet, null, faceTex);
				(bodyMesh.material as THREE.Material).dispose();
				bodyMesh.material = bodyMat;
				if (faceMesh) {
					((faceMesh as THREE.SkinnedMesh).material as THREE.Material).dispose();
					(faceMesh as THREE.SkinnedMesh).material = faceMats.face;
				}
			};
			setRig({
				cos,
				setBodyVisible: (on) => {
					for (const c of charMeshes) c.visible = on;
				},
				frame,
				applyMaterial,
			});
			setStatus("");
		})().catch((e) => setStatus(`error: ${String(e)}`));

		const tick = () => {
			raf = requestAnimationFrame(tick);
			controls.update();
			renderer.render(scene, camera);
		};
		raf = requestAnimationFrame(tick);

		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			window.removeEventListener("keydown", onKey);
			renderer.domElement.removeEventListener("pointerdown", onPointerDown);
			renderer.domElement.removeEventListener("pointerup", onPointerUp);
			transform.detach();
			transform.dispose();
			transformRef.current = null;
			cos?.dispose();
			controls.dispose();
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, []);

	// attach the gizmo's proxy under the selected rigid item's attach bone (so the
	// proxy's local TRS == the manifest's bone-local offset/rotate/scale). Re-runs
	// when the worn variant changes; NOT keyed on manifest, so a live drag never
	// tears the gizmo down mid-move.
	const selVariant = selected ? worn[selected]?.variantId : undefined;
	useEffect(() => {
		const transform = transformRef.current;
		if (!transform || !rig || !selected) return;
		const def = rig.cos.slots()[selected] as ItemDef | undefined;
		const isRigid = !!def && def.attach !== "skinned";
		if (!gizmoOn || !isRigid || !selVariant) {
			transform.detach();
			proxyRef.current?.removeFromParent();
			proxyRef.current = null;
			return;
		}
		const bone = rig.cos.targets().find((o) => (o as THREE.Mesh).isMesh)?.parent;
		if (!bone) return;
		const proxy = new THREE.Object3D();
		proxy.position.set(...(def.offset ?? [0, 0, 0]));
		proxy.quaternion.copy(quatFromDeg(def.rotate ?? [0, 0, 0]));
		proxy.scale.setScalar(def.scale ?? 1);
		bone.add(proxy);
		proxyRef.current = proxy;
		transform.attach(proxy);
		return () => {
			transform.detach();
			proxy.removeFromParent();
			if (proxyRef.current === proxy) proxyRef.current = null;
		};
	}, [gizmoOn, selected, selVariant, rig]);

	const wear = (itemKey: string, variantId?: string) => {
		if (!rig || !manifest) return;
		const def = manifest[itemKey];
		const next: WornState = { ...worn };
		const evicted = Object.keys(next).filter(
			(k) => k !== itemKey && effSlot(k, manifest[k]) === effSlot(itemKey, def),
		);
		for (const k of evicted) delete next[k];
		const vid = variantId ?? worn[itemKey]?.variantId ?? def.variants[0].id;
		next[itemKey] = { variantId: vid };
		setWorn(next);
		setSelected(itemKey);
		setActiveOutfitId(null); // manual edit breaks the outfit bundle
		run(async () => {
			for (const k of evicted) rig.cos.unequip(k);
			await rig.cos.equip(itemKey, vid);
		});
	};

	// equip the item the catalog was opened on, once the rig is ready
	useEffect(() => {
		if (!rig || !manifest || openedRef.current) return;
		openedRef.current = true;
		if (item && manifest[item]) wear(item);
	});

	const takeOff = (itemKey: string) => {
		if (!rig) return;
		setWorn((w) => {
			const next = { ...w };
			delete next[itemKey];
			return next;
		});
		run(() => rig.cos.unequip(itemKey));
	};

	const paint = (itemKey: string, color: string | null) => {
		if (!rig || !worn[itemKey]) return;
		setWorn((w) => ({ ...w, [itemKey]: { ...w[itemKey], color: color ?? undefined } }));
		run(() => rig.cos.setColor(itemKey, color));
	};

	// mutate the live manifest def and re-attach so the new scale/offset/rotate applies
	const retune = (
		itemKey: string,
		patch: { scale?: number; offset?: [number, number, number]; rotate?: [number, number, number] },
	) => {
		if (!rig) return;
		const def = rig.cos.slots()[itemKey] as ItemDef;
		if (patch.scale !== undefined) def.scale = patch.scale;
		if (patch.offset) def.offset = patch.offset;
		if (patch.rotate) def.rotate = patch.rotate;
		setManifest({ ...(rig.cos.slots() as ItemManifest) });
		// keep the gizmo proxy in step with slider edits (only when it's the active item)
		if (itemKey === selected && proxyRef.current) {
			const p = proxyRef.current;
			if (patch.offset) p.position.set(...patch.offset);
			if (patch.rotate) p.quaternion.copy(quatFromDeg(patch.rotate));
			if (patch.scale !== undefined) p.scale.setScalar(patch.scale);
		}
		const w = worn[itemKey];
		if (w) {
			run(async () => {
				rig.cos.unequip(itemKey);
				await rig.cos.equip(itemKey, w.variantId);
				if (w.color) rig.cos.setColor(itemKey, w.color);
			});
		}
	};

	const copyTuning = (def: ItemDef) => {
		const patch = {
			scale: def.scale ?? 1,
			offset: def.offset ?? [0, 0, 0],
			rotate: def.rotate ?? [0, 0, 0],
		};
		navigator.clipboard.writeText(JSON.stringify(patch)).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		});
	};

	// write the current tuning into public/cosmetics/manifest.json via the dev API
	const saveTuning = async (itemKey: string, def: ItemDef) => {
		setSaveState("saving");
		try {
			const r = await fetch("/api/sidekick/manifest-tune", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					item: itemKey,
					scale: def.scale ?? 1,
					offset: def.offset ?? [0, 0, 0],
					rotate: def.rotate ?? [0, 0, 0],
				}),
			});
			if (!r.ok) throw new Error(await r.text());
			setSaveState("saved");
		} catch {
			setSaveState("error");
		}
		setTimeout(() => setSaveState("idle"), 1600);
	};

	// load the complete material library once; default to the first
	useEffect(() => {
		fetch("/api/sidekick/materials")
			.then((r) => r.json())
			.then((d: { materials?: Material[] }) => {
				const list = d.materials ?? [];
				setMaterials(list);
				setActiveMatId((cur) => cur ?? list[0]?.id ?? null);
			})
			.catch(() => {});
	}, []);

	const activeMaterial = materials.find((m) => m.id === activeMatId) ?? null;
	// apply the active material (color/tex/opacity/fx) live whenever it changes
	useEffect(() => {
		if (rig && activeMaterial) rig.applyMaterial(activeMaterial);
	}, [rig, activeMaterial]);

	// load outfits (kits) once
	useEffect(() => {
		fetch("/api/sidekick/outfits")
			.then((r) => r.json())
			.then((d: { outfits?: Outfit[] }) => setOutfits(d.outfits ?? []))
			.catch(() => {});
	}, []);

	// equip a whole outfit: apply its material (if any) + swap all worn items for
	// its parts. This is the kit model — outfits just compose the material + the
	// existing cosmetic-attach path, nothing new in the engine.
	const equipOutfit = (o: Outfit) => {
		if (!rig || !manifest) return;
		if (o.material) {
			const m = materials.find((x) => x.id === o.material);
			if (m) setActiveMatId(m.id); // triggers applyMaterial via the effect
		}
		const prevKeys = Object.keys(worn);
		const next: WornState = {};
		for (const p of o.parts) {
			const def = manifest[p.item];
			if (def) next[p.item] = { variantId: p.variantId ?? def.variants[0].id };
		}
		setWorn(next);
		setActiveOutfitId(o.id);
		setSelected(o.parts[0]?.item ?? null);
		run(async () => {
			for (const k of prevKeys) rig.cos.unequip(k);
			for (const p of o.parts) {
				if (manifest[p.item]) await rig.cos.equip(p.item, next[p.item].variantId);
			}
		});
	};

	const updateMaterial = (patch: Partial<Material>) => {
		if (!activeMatId) return;
		setMaterials((list) => list.map((m) => (m.id === activeMatId ? { ...m, ...patch } : m)));
	};
	const toggleShipped = (id: string) => {
		setMaterials((list) => list.map((m) => (m.id === id ? { ...m, shipped: !m.shipped } : m)));
	};
	const newMaterial = () => {
		const base = activeMaterial ?? materials[0];
		if (!base) return;
		const id = `mat-${Math.random().toString(36).slice(2, 8)}`;
		setMaterials((list) => [...list, { ...base, id, name: "New material", shipped: false }]);
		setActiveMatId(id);
	};
	const deleteMaterial = (id: string) => {
		setMaterials((list) => {
			const next = list.filter((m) => m.id !== id);
			if (id === activeMatId) setActiveMatId(next[0]?.id ?? null);
			return next;
		});
	};
	const saveMaterials = async () => {
		setMatSaveState("saving");
		try {
			const r = await fetch("/api/sidekick/materials", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ materials }),
			});
			if (!r.ok) throw new Error(await r.text());
			setMatSaveState("saved");
		} catch {
			setMatSaveState("error");
		}
		setTimeout(() => setMatSaveState("idle"), 1600);
	};

	// load the curated shop catalog once so membership state survives reloads
	useEffect(() => {
		fetch("/api/sidekick/catalog")
			.then((r) => r.json())
			.then((d: { entries?: CatalogEntry[] }) => setCatEntries(d.entries ?? []))
			.catch(() => {});
	}, []);

	// add/remove a configured instance (item + variant OR item + color) in
	// shop-catalog.json — the inventory of what may rotate into the shop. Both
	// endpoints return the full updated list, so we adopt it as the source of truth.
	const toggleCatalog = async (renderKey: string, body: object, remove: boolean) => {
		setCatState("saving");
		try {
			const r = await fetch(`/api/sidekick/catalog-${remove ? "remove" : "add"}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(remove ? { renderKey } : body),
			});
			if (!r.ok) throw new Error(await r.text());
			const d = (await r.json()) as { entries?: CatalogEntry[] };
			if (d.entries) setCatEntries(d.entries);
			setCatState("idle");
		} catch {
			setCatState("error");
			setTimeout(() => setCatState("idle"), 1600);
		}
	};

	const groups = manifest
		? [...Object.entries(manifest)].reduce((m, [k, def]) => {
				const slot = effSlot(k, def);
				(m.get(slot) ?? m.set(slot, []).get(slot)!).push(k);
				return m;
			}, new Map<string, string[]>())
		: null;

	const sel = selected && manifest ? manifest[selected] : null;
	const selWorn = selected ? worn[selected] : undefined;
	const rigid = sel ? sel.attach !== "skinned" : false;

	// The configured instance currently worn: item key (matches core's WARDROBE_SLOTS,
	// NOT the mutual-exclusion group) + a solid color OR a textured variant. Its
	// renderKey is the shop/economy identity; adding it catalogs THIS exact edition.
	const catInstance =
		selected && selWorn
			? selWorn.color
				? {
						renderKey: `${selected}-c${selWorn.color.replace(/^#/, "")}`,
						body: { slot: selected, color: selWorn.color },
						label: `${selected} · ${selWorn.color}`,
					}
				: {
						renderKey: `${selected}-${selWorn.variantId}`,
						body: { slot: selected, variantId: selWorn.variantId },
						label: `${sel?.variants.find((v) => v.id === selWorn.variantId)?.name ?? selWorn.variantId} ${selected}`,
					}
			: null;
	const inCatalog = catInstance ? catalog.has(catInstance.renderKey) : false;

	return (
		<div className="flex h-screen flex-col bg-neutral-950 text-white">
			<div className="flex min-h-0 flex-1">
			<aside className="w-60 shrink-0 overflow-y-auto border-r border-white/10 p-4">
				<button
					type="button"
					className="mb-3 text-xs text-neutral-400 hover:text-white"
					onClick={onBack}
				>
					← catalog
				</button>
				<h1 className="text-sm font-bold">3D Workbench</h1>
				<p className="mb-4 mt-1 text-xs text-neutral-500">
					{status || `${manifest ? Object.keys(manifest).length : 0} items · click to equip`}
				</p>
				{/* base-character material editor — sits above the equippable slots */}
				<div className="mb-3">
					<div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
						base
					</div>
					<button
						type="button"
						className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
							selected === SKIN_KEY ? "bg-white/10" : "hover:bg-white/5"
						}`}
						onClick={() => setSelected(SKIN_KEY)}
					>
						<span
							className="h-3 w-3 rounded-full border border-white/20"
							style={{ background: activeMaterial?.bodyColor ?? "#ffbb29" }}
						/>
						material{activeMaterial ? ` · ${activeMaterial.name}` : ""}
					</button>
				</div>
				{/* outfits (kits): equip a bundled material + parts in one click */}
				{outfits.length > 0 && (
					<div className="mb-3">
						<div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
							outfits
						</div>
						{outfits.map((o) => (
							<button
								key={o.id}
								type="button"
								className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left ${
									activeOutfitId === o.id ? "bg-white/10" : "hover:bg-white/5"
								}`}
								onClick={() => equipOutfit(o)}
								title={o.note}
							>
								<span className="flex items-center gap-2 text-xs">
									<span
										className={`h-1.5 w-1.5 rounded-full ${
											activeOutfitId === o.id ? "bg-emerald-400" : "bg-neutral-700"
										}`}
									/>
									{o.name}
								</span>
								<span className="ml-3.5 text-[10px] text-neutral-500">
									{o.material ? "skin + " : "costume · "}
									{o.parts.length} part{o.parts.length === 1 ? "" : "s"}
								</span>
							</button>
						))}
					</div>
				)}
				{groups &&
					[...groups.entries()].map(([slot, keys]) => (
						<div key={slot} className="mb-3">
							<div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
								{slot}
							</div>
							{keys.map((k) => (
								<div
									key={k}
									className={`group flex items-center rounded-md ${
										selected === k ? "bg-white/10" : "hover:bg-white/5"
									}`}
								>
									<button
										type="button"
										className="flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"
										onClick={() => wear(k)}
									>
										<span
											className={`h-1.5 w-1.5 rounded-full ${
												worn[k] ? "bg-emerald-400" : "bg-neutral-700"
											}`}
										/>
										{k}
									</button>
									{worn[k] && (
										<button
											type="button"
											className="px-2 text-neutral-500 opacity-0 hover:text-white group-hover:opacity-100"
											onClick={() => takeOff(k)}
											title="unequip"
										>
											×
										</button>
									)}
								</div>
							))}
						</div>
					))}
			</aside>

			<main className="relative min-w-0 flex-1">
				<div
					ref={mountRef}
					className="absolute inset-0 [background:repeating-conic-gradient(#141414_0%_25%,#1b1b1b_0%_50%)] [background-size:28px_28px]"
				/>
				<div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-2">
					{(
						[
							[bodyOn ? "hide body" : "show body", () => {
								rig?.setBodyVisible(!bodyOn);
								setBodyOn(!bodyOn);
							}],
							["frame character", () => rig?.frame(null)],
							["frame items", () => rig && run(() => rig.frame(rig.cos.targets()))],
						] as const
					).map(([label, onClick]) => (
						<button
							key={label}
							type="button"
							className="rounded-full border border-white/10 bg-neutral-900/80 px-3 py-1 text-xs backdrop-blur hover:bg-neutral-800"
							onClick={onClick}
						>
							{label}
						</button>
					))}
				</div>
			</main>

			<aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 p-4">
				{selected === SKIN_KEY ? (
					<MaterialPanel
						materials={materials}
						activeMatId={activeMatId}
						saveState={matSaveState}
						onSelect={setActiveMatId}
						onNew={newMaterial}
						onDelete={deleteMaterial}
						onChange={updateMaterial}
						onToggleShipped={toggleShipped}
						onSave={saveMaterials}
					/>
				) : !sel || !selected ? (
					<p className="text-xs text-neutral-500">Select an item to inspect it.</p>
				) : (
					<>
						<div className="flex items-baseline justify-between">
							<h2 className="text-sm font-bold">{selected}</h2>
							{selWorn && (
								<button
									type="button"
									className="text-xs text-neutral-400 hover:text-white"
									onClick={() => takeOff(selected)}
								>
									unequip
								</button>
							)}
						</div>
						<dl className="mt-2 space-y-1 text-xs text-neutral-400">
							<div className="flex justify-between gap-2">
								<dt>slot</dt>
								<dd className="text-neutral-200">{effSlot(selected, sel)}</dd>
							</div>
							<div className="flex justify-between gap-2">
								<dt>attach</dt>
								<dd className="text-neutral-200">{sel.attach}</dd>
							</div>
							<div className="flex justify-between gap-2">
								<dt>model</dt>
								<dd className="truncate text-neutral-200">{base(sel.model)}</dd>
							</div>
						</dl>

						<div className="mt-4">
							<div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
								Variants
							</div>
							{sel.variants.map((v) => (
								<button
									key={v.id}
									type="button"
									className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
										selWorn && !selWorn.color && selWorn.variantId === v.id
											? "bg-white/10"
											: "hover:bg-white/5"
									}`}
									onClick={() => wear(selected, v.id)}
								>
									<span>{v.name}</span>
									<span className="text-neutral-500">{base(v.tex) || "untextured"}</span>
								</button>
							))}
						</div>

						<div className="mt-4">
							<div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
								Solid color {selWorn ? "" : "(equip first)"}
							</div>
							<div className="flex flex-wrap gap-1.5">
								{SHOP_COLORS.map((c) => (
									<button
										key={c}
										type="button"
										disabled={!selWorn}
										className={`h-6 w-6 rounded-full border disabled:opacity-30 ${
											selWorn?.color === c ? "border-white" : "border-white/20"
										}`}
										style={{ background: c }}
										onClick={() => paint(selected, c)}
									/>
								))}
								{selWorn?.color && (
									<button
										type="button"
										className="h-6 rounded-full border border-white/20 px-2 text-[10px] text-neutral-300"
										onClick={() => paint(selected, null)}
									>
										clear
									</button>
								)}
							</div>
							{/* free color picker: any hex, and that exact color is what "add to
							    catalog" catalogs (renderKey slot-c<hex>). */}
							<label className="mt-2 flex items-center gap-2 text-[11px] text-neutral-400">
								<input
									type="color"
									disabled={!selWorn}
									value={selWorn?.color ?? "#4a8fe0"}
									className="h-7 w-10 cursor-pointer rounded border border-white/15 bg-neutral-900 disabled:opacity-30"
									onChange={(e) => selWorn && paint(selected, e.target.value)}
								/>
								<span className="font-mono">{selWorn?.color ?? "pick any color"}</span>
							</label>
						</div>

						<div className="mt-4">
							<div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-neutral-500">
								<span>Shop catalog</span>
								<span className="font-normal normal-case tracking-normal text-neutral-600">
									{catalog.size} item{catalog.size === 1 ? "" : "s"}
								</span>
							</div>
							{catInstance ? (
								<>
									<button
										type="button"
										disabled={catState === "saving"}
										className={`w-full rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50 ${
											inCatalog
												? "border-white/15 text-neutral-300 hover:bg-white/5"
												: "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10"
										}`}
										onClick={() => toggleCatalog(catInstance.renderKey, catInstance.body, inCatalog)}
									>
										{catState === "saving"
											? "saving…"
											: catState === "error"
												? "save failed ✗"
												: inCatalog
													? "in catalog ✓ — remove"
													: "add to catalog"}
									</button>
									<p className="mt-2 text-[10px] leading-4 text-neutral-500">
										Catalogs <code>{catInstance.renderKey}</code> into{" "}
										<code>shop-catalog.json</code> (@sidekick/core) — the curated set of
										instances that can rotate into the shop. Pick a variant or solid color
										above to choose which edition.
									</p>
								</>
							) : (
								<p className="text-[10px] leading-4 text-neutral-500">
									Equip a variant or solid color to add that exact edition to the shop catalog.
								</p>
							)}
						</div>

						{rigid && (
							<div className="mt-4">
								<div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
									Rigid attach tuning
								</div>
								<div className="mb-2 flex items-center gap-1.5">
									<button
										type="button"
										className={`rounded-md border px-2.5 py-1 text-xs ${
											gizmoOn
												? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
												: "border-white/15 text-neutral-300 hover:bg-white/5"
										}`}
										onClick={() => setGizmoOn((v) => !v)}
									>
										gizmo {gizmoOn ? "on" : "off"}
									</button>
									{gizmoOn &&
										(["translate", "rotate", "scale"] as const).map((m) => (
											<button
												key={m}
												type="button"
												title={m}
												className={`h-7 w-7 rounded-md border text-xs ${
													gizmoMode === m
														? "border-white bg-white text-neutral-900"
														: "border-white/15 text-neutral-300 hover:bg-white/5"
												}`}
												onClick={() => {
													transformRef.current?.setMode(m);
													setGizmoMode(m);
												}}
											>
												{m === "translate" ? "T" : m === "rotate" ? "R" : "S"}
											</button>
										))}
								</div>
								<p className="mb-2 text-[10px] leading-4 text-neutral-500">
									{!selWorn
										? "Equip this item to move it on the model."
										: gizmoOn
											? "Drag the handles. Keys: T move · R rotate · S scale. Click empty space to dismiss."
											: "Click the item in the viewport to grab it."}
								</p>
								<TuneRow
									label="scale"
									value={sel.scale ?? 1}
									fallback={1}
									min={0.5}
									max={1.5}
									step={0.01}
									onChange={(v) => retune(selected, { scale: v })}
								/>
								{(["x", "y", "z"] as const).map((axis, i) => (
									<TuneRow
										key={`off-${axis}`}
										label={`offset ${axis}`}
										value={sel.offset?.[i] ?? 0}
										fallback={0}
										// y (vertical seating) gets ~20% more travel than x/z
										min={axis === "y" ? -0.042 : -0.035}
										max={axis === "y" ? 0.042 : 0.035}
										step={0.001}
										onChange={(v) => {
											const offset = [...(sel.offset ?? [0, 0, 0])] as [number, number, number];
											offset[i] = v;
											retune(selected, { offset });
										}}
									/>
								))}
								{(["x", "y", "z"] as const).map((axis, i) => (
									<TuneRow
										key={`rot-${axis}`}
										label={`rotate ${axis}°`}
										value={sel.rotate?.[i] ?? 0}
										fallback={0}
										min={-60}
										max={60}
										step={1}
										onChange={(v) => {
											const rotate = [...(sel.rotate ?? [0, 0, 0])] as [number, number, number];
											rotate[i] = v;
											retune(selected, { rotate });
										}}
									/>
								))}
								<div className="mt-1 flex gap-2">
									<button
										type="button"
										className="rounded-md border border-white/15 px-2.5 py-1 text-xs hover:bg-white/5"
										onClick={() => copyTuning(sel)}
									>
										{copied ? "copied ✓" : "copy manifest patch"}
									</button>
									<button
										type="button"
										disabled={saveState === "saving"}
										className="rounded-md border border-emerald-400/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
										onClick={() => selected && saveTuning(selected, sel)}
									>
										{saveState === "saving"
											? "saving…"
											: saveState === "saved"
												? "saved ✓"
												: saveState === "error"
													? "save failed ✗"
													: "save to manifest"}
									</button>
								</div>
								<p className="mt-2 text-[10px] leading-4 text-neutral-500">
									Save writes <code>scale</code>/<code>offset</code>/<code>rotate</code> into{" "}
									<code>public/cosmetics/manifest.json</code> (neutral values are removed);
									copy just puts the patch on the clipboard. Rotate is bone-local degrees,
									pivoting on the attach bone.
								</p>
							</div>
						)}

						{selWorn && (
							<div className="mt-4">
								<div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
									Shop render
								</div>
								<img
									key={`${selected}-${selWorn.variantId}`}
									src={`/shop-renders/${selected}-${selWorn.variantId}.png`}
									alt=""
									className="h-24 w-24 rounded-lg bg-neutral-900"
									onError={(e) => {
										(e.target as HTMLImageElement).style.display = "none";
									}}
								/>
								<p className="mt-1 text-[10px] text-neutral-500">
									from /item-render (hidden if not rendered yet)
								</p>
							</div>
						)}
					</>
				)}
			</aside>
			</div>

			{/* bottom bar: entry point into the full shop catalog */}
			<div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-neutral-950 px-4 py-2">
				<span className="text-[11px] text-neutral-500">
					Shop catalog — the curated set that can rotate into the shop
				</span>
				<button
					type="button"
					className="rounded-full border border-white/15 px-3.5 py-1.5 text-xs hover:bg-white/5"
					onClick={() => setCatOpen(true)}
				>
					View catalog · {catEntries.length}
				</button>
			</div>

			{catOpen && (
				<CatalogModal
					entries={catEntries}
					manifest={manifest}
					onRemove={(renderKey) => toggleCatalog(renderKey, {}, true)}
					onClose={() => setCatOpen(false)}
				/>
			)}
		</div>
	);
}

// Modal listing everything in the curated shop catalog: each entry's shop render
// (falling back to a color/label chip), its identity, and a remove control.
function CatalogModal({
	entries,
	manifest,
	onRemove,
	onClose,
}: {
	entries: CatalogEntry[];
	manifest: ItemManifest | null;
	onRemove: (renderKey: string) => void;
	onClose: () => void;
}) {
	const sorted = [...entries].sort((a, b) => a.renderKey.localeCompare(b.renderKey));
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
			onClick={onClose}
		>
			<div
				className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
					<div>
						<h2 className="text-sm font-bold">Shop catalog</h2>
						<p className="text-[11px] text-neutral-500">
							{entries.length} item{entries.length === 1 ? "" : "s"} that can rotate into the shop
						</p>
					</div>
					<button
						type="button"
						className="text-neutral-400 hover:text-white"
						onClick={onClose}
						aria-label="close"
					>
						✕
					</button>
				</div>

				{sorted.length === 0 ? (
					<div className="p-10 text-center text-xs text-neutral-500">
						Nothing catalogued yet. Equip an item with a variant or solid color, then hit “add
						to catalog”.
					</div>
				) : (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto p-5">
						{sorted.map((e) => {
							const def = manifest?.[e.slot];
							const variantName = e.variantId
								? def?.variants.find((v) => v.id === e.variantId)?.name ?? e.variantId
								: null;
							return (
								<div
									key={e.renderKey}
									className="group relative rounded-xl border border-white/10 bg-neutral-950/50 p-2.5"
								>
									<button
										type="button"
										title="remove from catalog"
										className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900/80 text-neutral-400 opacity-0 hover:text-white group-hover:opacity-100"
										onClick={() => onRemove(e.renderKey)}
									>
										×
									</button>
									<div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg [background:repeating-conic-gradient(#161616_0%_25%,#1d1d1d_0%_50%)] [background-size:20px_20px]">
										<img
											src={`/shop-renders/${e.renderKey}.png`}
											alt={e.renderKey}
											className="h-full w-full object-contain"
											onError={(ev) => {
												const el = ev.target as HTMLImageElement;
												el.style.display = "none";
												el.nextElementSibling?.classList.remove("hidden");
											}}
										/>
										<span
											className="hidden h-8 w-8 rounded-full border border-white/20"
											style={e.color ? { background: e.color } : undefined}
										/>
									</div>
									<div className="mt-2 truncate text-xs font-semibold">{e.slot}</div>
									<div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
										{e.color ? (
											<>
												<span
													className="inline-block h-3 w-3 rounded-full border border-white/20"
													style={{ background: e.color }}
												/>
												<span>{e.color}</span>
											</>
										) : (
											<span>{variantName}</span>
										)}
									</div>
									<div className="mt-1 truncate font-mono text-[10px] text-neutral-600">
										{e.renderKey}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

// A labeled color picker: swatch + native input + live hex readout.
function ColorField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (hex: string) => void;
}) {
	return (
		<label className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
			<span className="flex-1">{label}</span>
			<span className="font-mono text-[11px] text-neutral-300">{value}</span>
			<input
				type="color"
				value={value}
				className="h-7 w-9 cursor-pointer rounded border border-white/15 bg-neutral-900"
				onChange={(e) => onChange(e.target.value)}
			/>
		</label>
	);
}

// The complete-material editor. The library is a grid of packaged looks (color +
// texture + transparency + shader effect); click one to preview it live on the
// body, star it to mark it for the product, and edit every variable below. Save
// writes the whole library to materials.json.
function MaterialPanel({
	materials,
	activeMatId,
	saveState,
	onSelect,
	onNew,
	onDelete,
	onChange,
	onToggleShipped,
	onSave,
}: {
	materials: Material[];
	activeMatId: string | null;
	saveState: "idle" | "saving" | "saved" | "error";
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
	onChange: (patch: Partial<Material>) => void;
	onToggleShipped: (id: string) => void;
	onSave: () => void;
}) {
	const active = materials.find((m) => m.id === activeMatId) ?? null;
	const shippedCount = materials.filter((m) => m.shipped).length;
	const fx = active?.fx ?? {};
	const setFx = (patch: Partial<MaterialParams>) => onChange({ fx: { ...fx, ...patch } });
	// texture generator + library
	const [prompt, setPrompt] = useState("");
	const [genState, setGenState] = useState<"idle" | "generating" | "error">("idle");
	const [library, setLibrary] = useState<string[]>([]);
	useEffect(() => {
		fetch("/api/sidekick/skin-textures")
			.then((r) => r.json())
			.then((d: { textures?: string[] }) => setLibrary(d.textures ?? []))
			.catch(() => {});
	}, []);
	const generate = async () => {
		const p = prompt.trim();
		if (!p || genState === "generating") return;
		setGenState("generating");
		try {
			const r = await fetch("/api/sidekick/skin-texture", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: p }),
			});
			if (!r.ok) throw new Error(await r.text());
			const d = (await r.json()) as { url: string };
			setLibrary((l) => [d.url, ...l.filter((u) => u !== d.url)]);
			onChange({ tex: d.url });
			setGenState("idle");
		} catch {
			setGenState("error");
			setTimeout(() => setGenState("idle"), 2500);
		}
	};

	return (
		<>
			<div className="flex items-baseline justify-between">
				<h2 className="text-sm font-bold">Materials</h2>
				<span className="text-[11px] text-neutral-500">{shippedCount} shipped</span>
			</div>
			<p className="mb-3 mt-0.5 text-[11px] text-neutral-500">
				Complete packaged looks. Click to preview; ★ ships to the product.
			</p>

			<div className="mb-3 grid grid-cols-3 gap-1.5">
				{materials.map((m) => (
					<div
						key={m.id}
						className={`relative rounded-md border px-2 py-1.5 ${
							m.id === activeMatId ? "border-white bg-white/10" : "border-white/15 hover:bg-white/5"
						}`}
					>
						<button
							type="button"
							className="flex w-full items-center gap-1.5 pr-4 text-left text-xs text-neutral-200"
							title={`preview ${m.name}`}
							onClick={() => onSelect(m.id)}
						>
							<span
								className="h-3 w-3 shrink-0 rounded-full border border-white/20"
								style={{ background: m.bodyColor, opacity: m.opacity ?? 1 }}
							/>
							<span className="truncate">{m.name}</span>
						</button>
						<button
							type="button"
							title={m.shipped ? "shipped — click to unship" : "ship to product"}
							className={`absolute right-1 top-1 text-[11px] ${
								m.shipped ? "text-amber-300" : "text-neutral-600 hover:text-neutral-300"
							}`}
							onClick={() => onToggleShipped(m.id)}
						>
							{m.shipped ? "★" : "☆"}
						</button>
					</div>
				))}
				<button
					type="button"
					className="rounded-md border border-dashed border-white/20 px-2 py-1.5 text-xs text-neutral-400 hover:bg-white/5"
					onClick={onNew}
				>
					+ new
				</button>
			</div>

			<div className="mb-3 flex items-center gap-2">
				<button
					type="button"
					disabled={saveState === "saving"}
					className="rounded-md border border-emerald-400/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
					onClick={onSave}
				>
					{saveState === "saving"
						? "saving…"
						: saveState === "saved"
							? "saved ✓"
							: saveState === "error"
								? "save failed ✗"
								: "save library"}
				</button>
				<span className="text-[10px] leading-4 text-neutral-500">→ materials.json</span>
			</div>

			{!active ? (
				<p className="text-xs text-neutral-500">No material selected.</p>
			) : (
				<>
					<label className="mb-3 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
						Name
						<input
							type="text"
							value={active.name}
							className="mt-1 w-full rounded border border-white/15 bg-neutral-900 px-2 py-1 text-xs font-normal normal-case tracking-normal text-neutral-200"
							onChange={(e) => onChange({ name: e.target.value })}
						/>
					</label>

					<div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
						Color &amp; cel
					</div>
					<ColorField label="body color" value={active.bodyColor} onChange={(hex) => onChange({ bodyColor: hex })} />
					<ColorField label="shadow color" value={active.shadowColor} onChange={(hex) => onChange({ shadowColor: hex })} />
					<TuneRow label="shadow amount" value={active.shadowAmt} fallback={0.5} min={0} max={1} step={0.01} onChange={(v) => onChange({ shadowAmt: v })} />
					<TuneRow label="softness" value={active.softness} fallback={0} min={0} max={1} step={0.01} onChange={(v) => onChange({ softness: v })} />
					<ColorField label="rim color" value={active.rimColor} onChange={(hex) => onChange({ rimColor: hex })} />
					<TuneRow label="rim strength" value={active.rimStrength} fallback={0} min={0} max={1} step={0.01} onChange={(v) => onChange({ rimStrength: v })} />
					<TuneRow label="rim width" value={active.rimWidth} fallback={0.35} min={0} max={0.6} step={0.01} onChange={(v) => onChange({ rimWidth: v })} />

					<div className="mb-1.5 mt-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
						Transparency
					</div>
					<TuneRow label="opacity" value={active.opacity ?? 1} fallback={1} min={0.1} max={1} step={0.01} onChange={(v) => onChange({ opacity: v })} />

					<div className="mb-1.5 mt-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
						Effect
					</div>
					<TuneRow label="iridescence" value={fx.irid ?? 0} fallback={0} min={0} max={1} step={0.01} onChange={(v) => setFx({ irid: v })} />
					<TuneRow label="hue scale" value={fx.iridScale ?? 3} fallback={3} min={0.5} max={8} step={0.1} onChange={(v) => setFx({ iridScale: v })} />
					<TuneRow label="specular" value={fx.spec ?? 0} fallback={0} min={0} max={1} step={0.01} onChange={(v) => setFx({ spec: v })} />
					<TuneRow label="spec tightness" value={fx.specPower ?? 40} fallback={40} min={4} max={120} step={1} onChange={(v) => setFx({ specPower: v })} />
					<ColorField label="spec color" value={fx.specColor ?? "#ffffff"} onChange={(hex) => setFx({ specColor: hex })} />
					<TuneRow label="velvet" value={fx.velvet ?? 0} fallback={0} min={0} max={1} step={0.01} onChange={(v) => setFx({ velvet: v })} />
					<ColorField label="velvet color" value={fx.velvetColor ?? "#050a14"} onChange={(hex) => setFx({ velvetColor: hex })} />
					<TuneRow label="emissive glow" value={fx.emissive ?? 0} fallback={0} min={0} max={1} step={0.01} onChange={(v) => setFx({ emissive: v })} />
					<TuneRow label="rim boost" value={fx.rimBoost ?? 0} fallback={0} min={0} max={1} step={0.01} onChange={(v) => setFx({ rimBoost: v })} />

					<div className="mb-1.5 mt-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
						Texture (image-gen)
					</div>
					<div className="mb-2 flex gap-2">
						<input
							type="text"
							value={prompt}
							placeholder="describe a texture…"
							className="min-w-0 flex-1 rounded border border-white/15 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
							onChange={(e) => setPrompt(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") generate();
							}}
						/>
						<button
							type="button"
							disabled={genState === "generating" || !prompt.trim()}
							className="rounded-md border border-emerald-400/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40"
							onClick={generate}
						>
							{genState === "generating" ? "…" : genState === "error" ? "✗ retry" : "generate"}
						</button>
					</div>
					<div className="mb-2 flex flex-wrap gap-1">
						{[
							"oil slick iridescent",
							"galaxy nebula",
							"polished marble",
							"military camo",
							"holographic foil",
							"tie-dye",
							"knitted wool",
							"leopard spots",
							"circuit board",
							"watercolor wash",
						].map((p) => (
							<button
								key={p}
								type="button"
								className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5"
								onClick={() => setPrompt(p)}
							>
								{p}
							</button>
						))}
					</div>
					{genState === "generating" && (
						<p className="mb-2 text-[10px] text-neutral-500">generating texture… (~10–20s)</p>
					)}
					{active.tex && (
						<>
							<div className="mb-2 flex items-center gap-2">
								<img src={active.tex} alt="" className="h-12 w-12 rounded border border-white/15 object-cover" />
								<button
									type="button"
									className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5"
									onClick={() => onChange({ tex: null })}
								>
									remove texture
								</button>
							</div>
							<TuneRow label="tiling" value={active.texRepeat ?? 1} fallback={1} min={1} max={8} step={1} onChange={(v) => onChange({ texRepeat: v })} />
						</>
					)}
					{library.length > 0 && (
						<div className="mb-3">
							<div className="mb-1 text-[10px] text-neutral-500">library</div>
							<div className="grid grid-cols-5 gap-1">
								{library.slice(0, 20).map((url) => (
									<button
										key={url}
										type="button"
										title={url}
										className={`aspect-square overflow-hidden rounded border ${
											active.tex === url ? "border-white" : "border-white/10 hover:border-white/30"
										}`}
										onClick={() => onChange({ tex: url })}
									>
										<img src={url} alt="" className="h-full w-full object-cover" />
									</button>
								))}
							</div>
						</div>
					)}

					<div className="mt-3 flex items-center gap-2">
						<button
							type="button"
							className={`rounded-md border px-2.5 py-1 text-xs ${
								active.shipped
									? "border-amber-300/50 bg-amber-300/10 text-amber-200"
									: "border-white/15 text-neutral-300 hover:bg-white/5"
							}`}
							onClick={() => onToggleShipped(active.id)}
						>
							{active.shipped ? "★ shipping" : "☆ ship this"}
						</button>
						{materials.length > 1 && (
							<button
								type="button"
								className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-neutral-400 hover:bg-white/5"
								onClick={() => onDelete(active.id)}
							>
								delete
							</button>
						)}
					</div>
					<p className="mt-2 text-[10px] leading-4 text-neutral-500">
						Everything here is one packaged material — color, texture, transparency, and the
						effect stack — all on the cel core. Remember to <b>save library</b> to persist.
					</p>
				</>
			)}
		</>
	);
}
