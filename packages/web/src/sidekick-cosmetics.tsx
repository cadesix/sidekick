import { useEffect, useMemo, useRef, useState } from "react";
import { LuImagePlus, LuX } from "react-icons/lu";

// Sidekick Studio — Cosmetics, masked item-layer pipeline (single hero pose).
// Each look type has a MASK REGION drawn on the base plate (where the item goes).
// A masked gpt-image edit adds the item there without redrawing the base, so the
// item lands in the base's exact coordinates. We key the fill out → an item layer,
// then superimpose onto the base. Click a look to inspect all four stages.
// Backed by the dev-only /api/sidekick middleware (OpenAI key stays server-side).

type Region = { x: number; y: number; w: number; h: number };
type Profile = { styleGuide: string; spec: string; palette: Record<string, string>; refs: string[] };
type Look = {
	id: string;
	name: string;
	type: LookType;
	desc: string;
	base: string;
	region: Region;
	generation: string;
	isolation: string;
	superimpose: string;
	drift: number;
	createdAt: string;
};
type Store = { basePlate?: string; masks?: Record<string, Region>; items: Look[] };

const COST_PER_IMG: Record<string, number> = { high: 0.17, medium: 0.07, low: 0.02 };

type LookType = "head" | "face" | "outfit" | "accessory";
const LOOK_TYPES: { id: LookType; label: string; ph: string; where: string }[] = [
	{ id: "head", label: "Headwear", ph: "a red party hat", where: "over the top of the head" },
	{ id: "face", label: "Face", ph: "round black sunglasses", where: "over the eyes" },
	{ id: "outfit", label: "Outfit", ph: "a blue and white striped shirt", where: "over the torso" },
	{ id: "accessory", label: "Accessory", ph: "white lacrosse gloves", where: "over the hands" },
];

function refUrl(name: string) {
	return `/api/sidekick/ref/${encodeURIComponent(name)}`;
}
function outUrl(file: string) {
	return `/api/sidekick/out/${encodeURIComponent(file)}`;
}

const CHECKER =
	"bg-[conic-gradient(at_50%_50%,#eee_0_25%,#fff_0_50%,#eee_0_75%,#fff_0)] bg-[length:16px_16px]";

// Draw / adjust the mask region box over the base plate. Drag to draw a new box.
function RegionBox({
	src,
	region,
	onChange,
}: {
	src: string;
	region?: Region;
	onChange: (r: Region) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [draft, setDraft] = useState<Region | null>(null);
	const start = useRef<{ x: number; y: number } | null>(null);

	function frac(e: React.PointerEvent) {
		const r = ref.current?.getBoundingClientRect();
		if (!r) return { x: 0, y: 0 };
		return {
			x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
			y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
		};
	}
	const box = draft ?? region;

	return (
		<div
			ref={ref}
			onPointerDown={(e) => {
				e.currentTarget.setPointerCapture(e.pointerId);
				const p = frac(e);
				start.current = p;
				setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
			}}
			onPointerMove={(e) => {
				if (!start.current) return;
				const p = frac(e);
				const s = start.current;
				setDraft({
					x: Math.min(s.x, p.x),
					y: Math.min(s.y, p.y),
					w: Math.abs(p.x - s.x),
					h: Math.abs(p.y - s.y),
				});
			}}
			onPointerUp={() => {
				if (draft && draft.w > 0.02 && draft.h > 0.02) onChange(draft);
				start.current = null;
				setDraft(null);
			}}
			className={`relative cursor-crosshair select-none overflow-hidden rounded-lg border border-neutral-200 ${CHECKER}`}
		>
			<img src={src} alt="base plate" draggable={false} className="pointer-events-none w-full object-contain" />
			{box && box.w > 0 && (
				<div
					className="pointer-events-none absolute border-2 border-amber-500 bg-amber-400/20"
					style={{
						left: `${box.x * 100}%`,
						top: `${box.y * 100}%`,
						width: `${box.w * 100}%`,
						height: `${box.h * 100}%`,
					}}
				/>
			)}
		</div>
	);
}

export default function CosmeticsTab({ profile }: { profile: Profile | null }) {
	const [store, setStore] = useState<Store>({ items: [], masks: {} });
	const [name, setName] = useState("");
	const [type, setType] = useState<LookType>("head");
	const [desc, setDesc] = useState("");
	const [model, setModel] = useState<"gpt-image-2" | "gpt-image-1.5">("gpt-image-2");
	const [quality, setQuality] = useState("high");
	const [busy, setBusy] = useState(false);
	const [settingBase, setSettingBase] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [detail, setDetail] = useState<Look | null>(null);
	const baseInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		fetch("/api/sidekick/assets")
			.then((r) => r.json())
			.then((d) => setStore({ basePlate: d.basePlate, masks: d.masks ?? {}, items: d.items ?? [] }))
			.catch(() => {});
	}, []);

	const est = useMemo(() => COST_PER_IMG[quality] ?? 0.17, [quality]);
	const activeType = LOOK_TYPES.find((t) => t.id === type) ?? LOOK_TYPES[0];
	const region = store.masks?.[type];

	async function persist(patch: Partial<Store>) {
		const next = { ...store, ...patch };
		setStore(next);
		await fetch("/api/sidekick/assets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ items: next.items, masks: next.masks }),
		}).catch(() => {});
	}

	function setRegion(r: Region) {
		persist({ masks: { ...(store.masks ?? {}), [type]: r } });
	}

	function onBaseFile(file: File | undefined) {
		if (!file) return;
		setSettingBase(true);
		setError(null);
		const reader = new FileReader();
		reader.onload = async () => {
			try {
				const res = await fetch("/api/sidekick/set-base", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ dataUrl: reader.result }),
				});
				const d = await res.json();
				if (!res.ok || !d.basePlate) throw new Error(d.error ?? "failed to set base plate");
				setStore((s) => ({ ...s, basePlate: d.basePlate }));
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setSettingBase(false);
			}
		};
		reader.readAsDataURL(file);
	}

	async function generate() {
		if (!store.basePlate) return setError("Set a base plate first.");
		if (!region) return setError(`Draw the mask region for ${activeType.label} first.`);
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/sidekick/make-item", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ base: store.basePlate, region, desc, model, quality }),
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.error ?? "generation failed");
			const look: Look = {
				id: d.superimpose.replace(/\.[^.]+$/, ""),
				name: name.trim() || desc.trim().slice(0, 40) || "Untitled",
				type,
				desc,
				base: store.basePlate,
				region,
				generation: d.generation,
				isolation: d.isolation,
				superimpose: d.superimpose,
				drift: d.drift ?? 0,
				createdAt: new Date().toISOString(),
			};
			await persist({ items: [look, ...store.items] });
			setName("");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function remove(id: string) {
		await persist({ items: store.items.filter((l) => l.id !== id) });
		setDetail(null);
	}

	return (
		<div className="mx-auto grid max-w-[1400px] gap-6 p-6 lg:grid-cols-[380px_1fr]">
			<div className="space-y-4">
				{/* Base plate */}
				<div className="rounded-xl border border-neutral-200 bg-white p-4">
					<div className="mb-2 flex items-center justify-between">
						<span className="text-xs font-semibold text-neutral-500">Base plate · hero pose</span>
						{store.basePlate && (
							<button
								onClick={() => baseInput.current?.click()}
								className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-800"
							>
								replace
							</button>
						)}
					</div>
					<input
						ref={baseInput}
						type="file"
						accept="image/png,image/webp,image/jpeg"
						className="hidden"
						onChange={(e) => {
							onBaseFile(e.target.files?.[0]);
							e.target.value = "";
						}}
					/>
					{store.basePlate ? (
						<div>
							<p className="mb-1.5 text-[11px] text-neutral-400">
								Drag to draw where <b>{activeType.label}</b> goes ({activeType.where}).
							</p>
							<RegionBox src={refUrl(store.basePlate)} region={region} onChange={setRegion} />
							{!region && (
								<p className="mt-1.5 text-[11px] text-amber-600">
									No region for {activeType.label} yet — draw one above.
								</p>
							)}
						</div>
					) : (
						<button
							onClick={() => baseInput.current?.click()}
							disabled={settingBase}
							className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 py-8 text-neutral-500 transition hover:border-neutral-400 disabled:opacity-50"
						>
							<LuImagePlus className="h-6 w-6" />
							<span className="text-sm font-semibold">
								{settingBase ? "uploading…" : "Upload base plate"}
							</span>
						</button>
					)}
				</div>

				{/* Composer */}
				<div className="rounded-xl border border-neutral-200 bg-white p-4">
					<div>
						<span className="mb-1.5 block text-xs font-semibold text-neutral-500">Type</span>
						<div className="flex flex-wrap gap-1.5">
							{LOOK_TYPES.map((t) => (
								<button
									key={t.id}
									onClick={() => setType(t.id)}
									className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${
										type === t.id
											? "bg-neutral-900 text-white"
											: "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
									}`}
								>
									{t.label}
									{store.masks?.[t.id] && (
										<span className={`h-1.5 w-1.5 rounded-full ${type === t.id ? "bg-amber-400" : "bg-amber-500"}`} />
									)}
								</button>
							))}
						</div>
					</div>

					<label className="mt-3 block">
						<span className="mb-1 block text-xs font-semibold text-neutral-500">Name (optional)</span>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Party hat"
							className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
						/>
					</label>

					<label className="mt-3 block">
						<span className="mb-1 block text-xs font-semibold text-neutral-500">
							Describe the {activeType.label.toLowerCase()}
						</span>
						<textarea
							value={desc}
							onChange={(e) => setDesc(e.target.value)}
							rows={2}
							placeholder={activeType.ph}
							className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
						/>
					</label>

					<div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
						<label className="flex items-center gap-1">
							<span className="text-neutral-500">model</span>
							<select
								value={model}
								onChange={(e) => setModel(e.target.value as typeof model)}
								className="rounded border border-neutral-300 px-2 py-1"
							>
								<option value="gpt-image-2">gpt-image-2</option>
								<option value="gpt-image-1.5">gpt-image-1.5</option>
							</select>
						</label>
						<label className="flex items-center gap-1">
							<span className="text-neutral-500">quality</span>
							<select
								value={quality}
								onChange={(e) => setQuality(e.target.value)}
								className="rounded border border-neutral-300 px-2 py-1"
							>
								{["high", "medium", "low"].map((q) => (
									<option key={q}>{q}</option>
								))}
							</select>
						</label>
					</div>

					<button
						onClick={generate}
						disabled={busy || !desc.trim() || !store.basePlate || !region}
						className="mt-3 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
					>
						{busy ? "making item… (~1–2 min)" : `Make item · ~$${est.toFixed(2)}`}
					</button>
					{error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
				</div>
			</div>

			{/* Gallery */}
			<div>
				<h2 className="mb-3 text-sm font-semibold text-neutral-700">Items ({store.items.length})</h2>
				{store.items.length === 0 && !busy && (
					<p className="text-sm text-neutral-400">
						No items yet. Set a base plate, draw the mask region for a slot, describe an item, and Make
						item. Click a result to inspect every stage.
					</p>
				)}
				<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
					{busy && (
						<div className="flex aspect-square animate-pulse items-center justify-center rounded-xl bg-neutral-200 text-xs text-neutral-400">
							making…
						</div>
					)}
					{store.items.map((it) => (
						<button
							key={it.id}
							onClick={() => setDetail(it)}
							className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:border-neutral-300"
						>
							<div className={`${CHECKER}`}>
								<img
									src={outUrl(it.isolation)}
									alt={it.name}
									className="aspect-square w-full object-contain"
								/>
							</div>
							<div className="flex items-center justify-between gap-2 p-2">
								<span className="truncate text-sm font-medium text-neutral-800">{it.name}</span>
								{it.drift > 12 && (
									<span className="shrink-0 text-[10px] font-semibold text-red-500" title="the mask may have been ignored">
										drift {it.drift}%
									</span>
								)}
							</div>
						</button>
					))}
				</div>
			</div>

			{detail && (
				<StepDetail look={detail} onClose={() => setDetail(null)} onDelete={() => remove(detail.id)} />
			)}
		</div>
	);
}

function StepDetail({
	look,
	onClose,
	onDelete,
}: {
	look: Look;
	onClose: () => void;
	onDelete: () => void;
}) {
	const steps = [
		{ n: 1, label: "Base", src: refUrl(look.base) },
		{ n: 2, label: "Generation (masked edit)", src: outUrl(look.generation) },
		{ n: 3, label: "Isolation (item layer)", src: outUrl(look.isolation), checker: true },
		{ n: 4, label: "Superimpose", src: outUrl(look.superimpose) },
	];
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
			<div
				onClick={(e) => e.stopPropagation()}
				className="flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-5"
			>
				<div className="flex items-center gap-3">
					<h3 className="text-base font-semibold text-neutral-800">{look.name}</h3>
					<span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-500">
						{LOOK_TYPES.find((t) => t.id === look.type)?.label ?? look.type}
					</span>
					{look.drift > 12 && (
						<span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-500">
							drift {look.drift}% — mask may have been ignored
						</span>
					)}
					<button onClick={onClose} className="ml-auto text-neutral-400 hover:text-neutral-700">
						<LuX className="h-5 w-5" />
					</button>
				</div>

				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					{steps.map((s) => (
						<div key={s.n}>
							<div className="mb-1.5 flex items-center gap-1.5">
								<span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white">
									{s.n}
								</span>
								<span className="text-xs font-semibold text-neutral-600">{s.label}</span>
							</div>
							<div className={`aspect-square overflow-hidden rounded-lg border border-neutral-200 ${s.checker ? CHECKER : "bg-neutral-50"}`}>
								<img src={s.src} alt={s.label} className="h-full w-full object-contain" />
							</div>
						</div>
					))}
				</div>

				{look.desc && (
					<p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
						<span className="font-semibold">item:</span> {look.desc}
					</p>
				)}

				<div className="flex items-center border-t border-neutral-100 pt-3">
					<button onClick={onDelete} className="text-sm font-medium text-red-500 hover:text-red-700">
						Delete
					</button>
				</div>
			</div>
		</div>
	);
}
