import { useEffect, useMemo, useState } from "react";
import { AssetWorkbench, base, effSlot, type ItemDef, type ItemManifest } from "./asset-workbench";

// Dev-only Asset Manager (/asset-manager). Default view is a CATALOG of every
// item in cosmetics/manifest.json: render thumbnails, variants, and asset
// health (does the GLB exist? each variant's texture? its shop render?), so
// gaps in the pipeline are visible at a glance. Clicking a card opens the 3D
// workbench (asset-workbench.tsx) to iterate on that item on the live rig.
// The view is kept in the URL (?view=3d&item=hat) so reload/back work.

const MANIFEST_URL = "/cosmetics/manifest.json?v=1";

type VariantHealth = { tex: boolean | null; render: boolean }; // tex null = untextured by design
type ItemHealth = { model: boolean; variants: Record<string, VariantHealth> };
type Health = Record<string, ItemHealth>;

type View = { mode: "catalog" } | { mode: "workbench"; item?: string };

// Vite's dev server answers 200 + index.html for ANY missing path (SPA
// fallback), so existence = ok AND not the html fallback.
const exists = async (url: string) => {
	try {
		const r = await fetch(url, { method: "HEAD" });
		return r.ok && !(r.headers.get("content-type") ?? "").includes("text/html");
	} catch {
		return false;
	}
};

const viewFromURL = (): View => {
	const q = new URLSearchParams(window.location.search);
	return q.get("view") === "3d"
		? { mode: "workbench", item: q.get("item") ?? undefined }
		: { mode: "catalog" };
};

export default function AssetManager() {
	const [manifest, setManifest] = useState<ItemManifest | null>(null);
	const [health, setHealth] = useState<Health | null>(null);
	const [view, setView] = useState<View>(viewFromURL);

	useEffect(() => {
		fetch(MANIFEST_URL)
			.then((r) => r.json())
			.then(setManifest)
			.catch((e) => console.error("[asset-manager] manifest load failed:", e));
	}, []);

	useEffect(() => {
		if (!manifest) return;
		let cancelled = false;
		(async () => {
			const entries = await Promise.all(
				Object.entries(manifest).map(async ([k, def]) => {
					const [model, variants] = await Promise.all([
						exists(def.model),
						Promise.all(
							def.variants.map(async (v) => {
								const [tex, render] = await Promise.all([
									v.tex ? exists(v.tex) : Promise.resolve(null),
									exists(`/shop-renders/${k}-${v.id}.png`),
								]);
								return [v.id, { tex, render }] as const;
							}),
						).then(Object.fromEntries),
					]);
					return [k, { model, variants }] as const;
				}),
			);
			if (!cancelled) setHealth(Object.fromEntries(entries));
		})();
		return () => {
			cancelled = true;
		};
	}, [manifest]);

	useEffect(() => {
		const onPop = () => setView(viewFromURL());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	const open = (item?: string) => {
		const q = item ? `?view=3d&item=${encodeURIComponent(item)}` : "?view=3d";
		history.pushState(null, "", `/asset-manager${q}`);
		setView({ mode: "workbench", item });
	};
	const close = () => {
		history.pushState(null, "", "/asset-manager");
		setView({ mode: "catalog" });
	};

	if (view.mode === "workbench") {
		return <AssetWorkbench item={view.item ?? null} onBack={close} />;
	}
	return <Catalog manifest={manifest} health={health} onOpen={open} />;
}

function Catalog({
	manifest,
	health,
	onOpen,
}: {
	manifest: ItemManifest | null;
	health: Health | null;
	onOpen: (item?: string) => void;
}) {
	const [filter, setFilter] = useState<string | null>(null);

	const slots = useMemo(() => {
		if (!manifest) return [];
		const seen: string[] = [];
		for (const [k, def] of Object.entries(manifest)) {
			const s = effSlot(k, def);
			if (!seen.includes(s)) seen.push(s);
		}
		return seen;
	}, [manifest]);

	const items = manifest
		? Object.entries(manifest).filter(([k, def]) => !filter || effSlot(k, def) === filter)
		: [];

	const stats = useMemo(() => {
		if (!manifest) return null;
		let variants = 0;
		let missingTex = 0;
		let missingRender = 0;
		let missingModel = 0;
		for (const [k, def] of Object.entries(manifest)) {
			variants += def.variants.length;
			const h = health?.[k];
			if (!h) continue;
			if (!h.model) missingModel++;
			for (const v of def.variants) {
				if (h.variants[v.id]?.tex === false) missingTex++;
				if (h.variants[v.id]?.render === false) missingRender++;
			}
		}
		return { items: Object.keys(manifest).length, variants, missingTex, missingRender, missingModel };
	}, [manifest, health]);

	return (
		<div className="min-h-screen bg-neutral-950 text-white">
			<header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/90 px-6 py-4 backdrop-blur">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h1 className="text-base font-bold">Asset Catalog</h1>
						<p className="mt-0.5 text-xs text-neutral-500">
							{!stats
								? "loading manifest…"
								: [
										`${stats.items} items`,
										`${stats.variants} variants`,
										...(health
											? [
													stats.missingModel ? `${stats.missingModel} GLBs missing` : null,
													stats.missingTex ? `${stats.missingTex} textures missing` : null,
													stats.missingRender ? `${stats.missingRender} renders missing` : "all renders present",
												].filter(Boolean)
											: ["checking files…"]),
									].join(" · ")}
						</p>
					</div>
					<button
						type="button"
						className="rounded-full border border-white/15 px-3.5 py-1.5 text-xs hover:bg-white/5"
						onClick={() => onOpen()}
					>
						open 3D workbench
					</button>
				</div>
				<div className="mt-3 flex flex-wrap gap-1.5">
					{[null, ...slots].map((s) => (
						<button
							key={s ?? "all"}
							type="button"
							className={`rounded-full px-3 py-1 text-xs ${
								filter === s
									? "bg-white text-neutral-900"
									: "border border-white/15 text-neutral-300 hover:bg-white/5"
							}`}
							onClick={() => setFilter(s)}
						>
							{s ?? "all"}
						</button>
					))}
				</div>
			</header>

			<main className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-6">
				{items.map(([k, def]) => (
					<ItemCard key={k} itemKey={k} def={def} health={health?.[k]} onOpen={() => onOpen(k)} />
				))}
			</main>

			<footer className="px-6 pb-6 text-[11px] leading-5 text-neutral-600">
				New items: author the GLB in <code>tools/char-pipeline</code> (
				<code>build_&lt;item&gt;.py</code> against <code>character_master.blend</code>), drop it +
				textures under <code>public/cosmetics/</code>, add a manifest entry, then re-run{" "}
				<code>/item-render</code> for the shop renders.
			</footer>
		</div>
	);
}

function ItemCard({
	itemKey,
	def,
	health,
	onOpen,
}: {
	itemKey: string;
	def: ItemDef;
	health?: ItemHealth;
	onOpen: () => void;
}) {
	// hero image: first variant with a shop render, else the raw texture
	const hero = health
		? def.variants.find((v) => health.variants[v.id]?.render)
		: def.variants[0];
	const heroSrc = health
		? hero
			? `/shop-renders/${itemKey}-${hero.id}.png`
			: def.variants.find((v) => v.tex && health.variants[v.id]?.tex)?.tex ?? null
		: null;

	const missingTex = health ? def.variants.filter((v) => health.variants[v.id]?.tex === false) : [];
	const missingRender = health
		? def.variants.filter((v) => health.variants[v.id]?.render === false)
		: [];

	return (
		<button
			type="button"
			className="group rounded-2xl border border-white/10 bg-neutral-900/50 p-3 text-left transition hover:border-white/25 hover:bg-neutral-900"
			onClick={onOpen}
		>
			<div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl [background:repeating-conic-gradient(#161616_0%_25%,#1d1d1d_0%_50%)] [background-size:24px_24px]">
				{heroSrc ? (
					<img
						src={heroSrc}
						alt={itemKey}
						className="h-full w-full object-contain transition group-hover:scale-105"
					/>
				) : (
					<span className="text-xs text-neutral-600">{health ? "no art yet" : "…"}</span>
				)}
			</div>

			<div className="mt-2.5 flex items-center justify-between gap-2">
				<span className="truncate text-sm font-semibold">{itemKey}</span>
				<span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-neutral-400">
					{effSlot(itemKey, def)}
				</span>
			</div>
			<div className="mt-0.5 text-[11px] text-neutral-500">
				{def.attach} · {base(def.model)}
			</div>

			<div className="mt-2 flex flex-wrap items-center gap-1">
				{def.variants.map((v) => {
					const h = health?.variants[v.id];
					return h?.render ? (
						<img
							key={v.id}
							src={`/shop-renders/${itemKey}-${v.id}.png`}
							alt={v.name}
							title={v.name}
							className="h-7 w-7 rounded-md bg-neutral-800 object-contain"
						/>
					) : (
						<span
							key={v.id}
							title={`${v.name} — no render`}
							className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-white/15 text-[9px] text-neutral-500"
						>
							{v.id.slice(0, 2)}
						</span>
					);
				})}
			</div>

			{health && (!health.model || missingTex.length > 0 || missingRender.length > 0) && (
				<div className="mt-2 space-y-0.5 text-[10px]">
					{!health.model && <div className="text-red-400">GLB missing: {def.model}</div>}
					{missingTex.length > 0 && (
						<div className="text-amber-400">
							tex missing: {missingTex.map((v) => v.id).join(", ")}
						</div>
					)}
					{missingRender.length > 0 && (
						<div className="text-neutral-500">
							no render: {missingRender.map((v) => v.id).join(", ")}
						</div>
					)}
				</div>
			)}
		</button>
	);
}
