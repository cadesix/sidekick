import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	createCosmetics,
	type CosmeticsHandle,
	type SlotDef,
} from "./components/sidekick-equipment";
import { loadSettings } from "./components/sidekick-settings";
import { MODEL_URL } from "./components/sidekick-shading";
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

type Rig = {
	cos: CosmeticsHandle;
	setBodyVisible: (on: boolean) => void;
	frame: (targets: THREE.Object3D[] | null) => void;
};

// items sharing an effective slot are mutually exclusive (SHOP-NOTES.md)
export const effSlot = (key: string, def: ItemDef) => def.slot ?? key;

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
			const charMeshes: THREE.Mesh[] = [];
			model.traverse((c) => {
				if (c instanceof THREE.SkinnedMesh) {
					charMeshes.push(c);
					c.frustumCulled = false;
					if ((c.material as THREE.MeshStandardMaterial).map) body = c;
				}
			});
			if (!body) {
				setStatus("no textured body mesh in GLB");
				return;
			}
			// present assets in neutral day light (the active preset may live in
			// evening, whose warm tint distorts item colors)
			cos = createCosmetics(body, { ...loadSettings(), timeOfDay: "day" }, null);
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
			setRig({
				cos,
				setBodyVisible: (on) => {
					for (const c of charMeshes) c.visible = on;
				},
				frame,
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
			cos?.dispose();
			controls.dispose();
			renderer.dispose();
			mount.removeChild(renderer.domElement);
		};
	}, []);

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

	return (
		<div className="flex h-screen bg-neutral-950 text-white">
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
				{!sel || !selected ? (
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
						</div>

						{rigid && (
							<div className="mt-4">
								<div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
									Rigid attach tuning
								</div>
								<TuneRow
									label="scale"
									value={sel.scale ?? 1}
									fallback={1}
									min={0.2}
									max={3}
									step={0.01}
									onChange={(v) => retune(selected, { scale: v })}
								/>
								{(["x", "y", "z"] as const).map((axis, i) => (
									<TuneRow
										key={`off-${axis}`}
										label={`offset ${axis}`}
										value={sel.offset?.[i] ?? 0}
										fallback={0}
										min={-0.1}
										max={0.1}
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
										min={-180}
										max={180}
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
	);
}
