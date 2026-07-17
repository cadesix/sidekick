import { useEffect, useMemo, useState } from "react";

// Dev-only Shop Admin (/shop-admin). A merchandising surface for the daily drop:
// preview today's shop UI, preview tomorrow's, and browse the full catalog it
// draws from. NOT wired to the server yet — it composes a deterministic,
// date-seeded drop from the local pools (materials.json + cosmetics/manifest.json
// + a mock suits list) so the layout + tiering are visible and tunable.
//
// The drop model (what feels special + brings people back):
//   • Today's Skin ×1      — the identity flex (a material/skin), aspirational
//   • Hero Fit ×1          — one big suit/onesie, the "did you see today's fit?"
//   • Featured ×2          — standout accessories (rare)
//   • Everyday ×6          — t-shirts / a shoe / a basic hat (common, cheap)
// One hero of each kind keeps scarcity; the price ladder keeps everyone buying.

// ---- rarity + price (mirrors @sidekick/core/shop.ts) -----------------------
type Rarity = { min: number; label: string; chip: string; grad: [string, string] };
const RARITIES: readonly Rarity[] = [
	{ min: 200, label: "Legendary", chip: "#d99e1b", grad: ["#fff6dc", "#ffe9ac"] },
	{ min: 100, label: "Epic", chip: "#8a63d2", grad: ["#f3edff", "#e3d5ff"] },
	{ min: 60, label: "Rare", chip: "#4a8fe0", grad: ["#ebf3ff", "#d6e7ff"] },
	{ min: 0, label: "Common", chip: "#9aa3ad", grad: ["#f6f8fa", "#eaeef2"] },
];
const rarityOf = (cost: number) => RARITIES.find((r) => cost >= r.min) ?? RARITIES[3];
const PRICE: Record<string, number> = {
	shirt: 25, hoodie: 60, pants: 30, shorts: 25, hat: 40, beanie: 35, bucket: 45,
	wizard: 120, crown: 250, shoes: 45, sneakers: 70, boots: 80, glasses: 50,
	headphones: 85, earmuffs: 55, sweatband: 30, laurel: 150, propeller: 65,
	catbeanie: 60, cowboy: 75, stars: 65, goggles: 70, snorkel: 60, earring: 40,
	flower: 30, earbow: 30, scarf: 45, backpack: 90,
};
const DEFAULT_PRICE = 40;

// ---- seeded rng (mirrors core rng) -----------------------------------------
function hashStr(s: string) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function mulberry32(a: number) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---- mock suits (the new "hero fit" item type — no art yet) -----------------
type Suit = { id: string; name: string; emoji: string; cost: number; color: string };
const SUITS: Suit[] = [
	{ id: "dragon", name: "Dragon Onesie", emoji: "🐉", cost: 240, color: "#4a9b6b" },
	{ id: "astronaut", name: "Astronaut Suit", emoji: "🚀", cost: 250, color: "#dfe6ef" },
	{ id: "dino", name: "Dino Onesie", emoji: "🦖", cost: 180, color: "#7fae3a" },
	{ id: "shark", name: "Shark Onesie", emoji: "🦈", cost: 170, color: "#5a8fbf" },
	{ id: "bunny", name: "Bunny Onesie", emoji: "🐰", cost: 150, color: "#f0c4d4" },
	{ id: "bee", name: "Bee Onesie", emoji: "🐝", cost: 130, color: "#f2c744" },
	{ id: "robot", name: "Robot Suit", emoji: "🤖", cost: 200, color: "#9aa6b5" },
	{ id: "ghostie", name: "Ghost Onesie", emoji: "👻", cost: 140, color: "#e7ebef" },
	{ id: "frog", name: "Frog Onesie", emoji: "🐸", cost: 130, color: "#6cc98f" },
	{ id: "tiger", name: "Tiger Suit", emoji: "🐯", cost: 190, color: "#e8952f" },
];

// ---- data model -------------------------------------------------------------
type MaterialFx = { irid?: number; spec?: number; velvet?: number; emissive?: number };
type MaterialDef = {
	id: string; name: string; bodyColor: string; opacity?: number; tex?: string | null; fx?: MaterialFx;
};
type Variant = { id: string; name: string; tex?: string; color?: string };
type ItemDef = { model: string; attach: string; slot?: string; variants: Variant[] };
type Manifest = Record<string, ItemDef>;

type Drop = { skin: DropItem | null; suit: DropItem | null; featured: DropItem[]; everyday: DropItem[] };
type DropItem = {
	key: string;
	kind: "skin" | "suit" | "shirt" | "shoes" | "accessory";
	name: string;
	cost: number;
	art?: string; // shop-render url
	swatch?: string; // solid color (skins)
	emoji?: string; // suits
	badge?: string; // effect hint
};

// how "special" a material is → its price (holographic/transparent/textured cost more)
function skinCost(m: MaterialDef): number {
	const fx = m.fx ?? {};
	let c = 60;
	if (fx.irid) c += 90;
	if (fx.spec) c += 30;
	if (fx.velvet) c += 40;
	if (fx.emissive) c += 60;
	if (m.opacity && m.opacity < 1) c += 40;
	if (m.tex) c += 50;
	return Math.min(c, 260);
}
function skinBadge(m: MaterialDef): string | undefined {
	const fx = m.fx ?? {};
	if (fx.irid && fx.irid >= 0.8) return "holo";
	if (fx.irid) return "iridescent";
	if (m.opacity && m.opacity < 1) return "translucent";
	if (fx.emissive) return "glow";
	if (fx.velvet) return "velvet";
	if (fx.spec) return "glossy";
	if (m.tex) return "textured";
	return undefined;
}

const shoeSlots = new Set(["shoes", "sneakers", "boots"]);
const shirtSlots = new Set(["shirt", "hoodie"]);

function itemKind(slot: string): DropItem["kind"] {
	if (shoeSlots.has(slot)) return "shoes";
	if (shirtSlots.has(slot)) return "shirt";
	return "accessory";
}

// build the shoppable item pool from the manifest (one product per variant)
function itemsFromManifest(manifest: Manifest): DropItem[] {
	const out: DropItem[] = [];
	for (const [itemKey, def] of Object.entries(manifest)) {
		const slot = def.slot ?? itemKey;
		const base = PRICE[itemKey] ?? PRICE[slot] ?? DEFAULT_PRICE;
		def.variants.forEach((v, i) => {
			out.push({
				key: `${itemKey}-${v.id}`,
				kind: itemKind(slot),
				name: `${v.name} ${itemKey}`,
				cost: base + i * 5,
				art: `/shop-renders/${itemKey}-${v.id}.png`,
			});
		});
	}
	return out;
}

// pick n items with distinct keyFn values, seeded
function sample<T>(arr: T[], n: number, rng: () => number, keyFn: (t: T) => string): T[] {
	const pool = [...arr];
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	const seen = new Set<string>();
	const out: T[] = [];
	for (const it of pool) {
		if (out.length >= n) break;
		const k = keyFn(it);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(it);
	}
	return out;
}

function composeDrop(
	skins: DropItem[],
	suits: DropItem[],
	items: DropItem[],
	seed: string,
): Drop {
	const rng = mulberry32(hashStr(seed));
	const featuredPool = items.filter((i) => i.cost >= 60);
	const everydayPool = items.filter((i) => i.cost < 60);
	const skin = sample(skins, 1, rng, (s) => s.key)[0] ?? null;
	const suit = sample(suits, 1, rng, (s) => s.key)[0] ?? null;
	const featured = sample(featuredPool, 2, rng, (i) => i.key.split("-")[0]);
	const everyday = sample(everydayPool, 6, rng, (i) => i.key.split("-")[0]);
	return { skin, suit, featured, everyday };
}

function localDay(offset: number): string {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return d.toISOString().slice(0, 10);
}
function hoursUntilMidnight(): number {
	const now = new Date();
	const mid = new Date(now);
	mid.setHours(24, 0, 0, 0);
	return Math.max(1, Math.round((mid.getTime() - now.getTime()) / 3_600_000));
}

// ---- component --------------------------------------------------------------
export default function ShopAdmin() {
	const [tab, setTab] = useState<"today" | "tomorrow" | "catalog">("today");
	const [materials, setMaterials] = useState<MaterialDef[]>([]);
	const [manifest, setManifest] = useState<Manifest | null>(null);

	useEffect(() => {
		fetch("/api/sidekick/materials")
			.then((r) => r.json())
			.then((d: { materials?: MaterialDef[] }) => setMaterials(d.materials ?? []))
			.catch(() => {});
		fetch("/cosmetics/manifest.json?v=1")
			.then((r) => r.json())
			.then(setManifest)
			.catch(() => {});
	}, []);

	const skins = useMemo<DropItem[]>(
		() =>
			materials.map((m) => ({
				key: `skin-${m.id}`,
				kind: "skin",
				name: m.name,
				cost: skinCost(m),
				swatch: m.bodyColor,
				badge: skinBadge(m),
			})),
		[materials],
	);
	const suits = useMemo<DropItem[]>(
		() =>
			SUITS.map((s) => ({
				key: `suit-${s.id}`,
				kind: "suit",
				name: s.name,
				cost: s.cost,
				emoji: s.emoji,
				swatch: s.color,
			})),
		[],
	);
	const items = useMemo(() => (manifest ? itemsFromManifest(manifest) : []), [manifest]);

	const seed = tab === "tomorrow" ? localDay(1) : localDay(0);
	const drop = useMemo(() => composeDrop(skins, suits, items, seed), [skins, suits, items, seed]);
	const dropCount =
		(drop.skin ? 1 : 0) + (drop.suit ? 1 : 0) + drop.featured.length + drop.everyday.length;

	return (
		<div className="min-h-screen bg-neutral-950 text-white">
			<header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/90 px-6 py-4 backdrop-blur">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h1 className="text-base font-bold">Shop Admin</h1>
						<p className="mt-0.5 text-xs text-neutral-500">
							Daily-drop preview + catalog · not wired to the server yet · {dropCount} items today
						</p>
					</div>
					<div className="flex gap-1.5">
						{(["today", "tomorrow", "catalog"] as const).map((t) => (
							<button
								key={t}
								type="button"
								className={`rounded-full px-3 py-1 text-xs capitalize ${
									tab === t
										? "bg-white text-neutral-900"
										: "border border-white/15 text-neutral-300 hover:bg-white/5"
								}`}
								onClick={() => setTab(t)}
							>
								{t}
							</button>
						))}
					</div>
				</div>
			</header>

			<main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 p-6 lg:grid-cols-[420px_1fr]">
				{tab === "catalog" ? (
					<div className="lg:col-span-2">
						<CatalogView skins={skins} suits={suits} items={items} />
					</div>
				) : (
					<>
						<div>
							<ShopPreview
								drop={drop}
								preview={tab === "tomorrow"}
								resetsIn={hoursUntilMidnight()}
							/>
						</div>
						<DropRules drop={drop} />
					</>
				)}
			</main>
		</div>
	);
}

// The phone-framed shop UI mock: hero row (skin + fit), featured row, everyday grid.
function ShopPreview({
	drop,
	preview,
	resetsIn,
}: {
	drop: Drop;
	preview: boolean;
	resetsIn: number;
}) {
	return (
		<div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-900 shadow-2xl">
			<div className="flex items-center justify-between border-b border-white/10 bg-neutral-950/60 px-4 py-3">
				<div>
					<div className="text-sm font-bold">{preview ? "Tomorrow's Drop" : "Today's Shop"}</div>
					<div className="text-[10px] text-neutral-500">
						{preview ? `drops in ${resetsIn}h` : `restocks in ${resetsIn}h`}
					</div>
				</div>
				<div className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
					<span>🪙</span> 1,240
				</div>
			</div>

			<div className={`space-y-4 p-4 ${preview ? "opacity-70" : ""}`}>
				<div className="grid grid-cols-2 gap-3">
					{drop.skin && <HeroCard item={drop.skin} label="Today's Skin" />}
					{drop.suit && <HeroCard item={drop.suit} label="Hero Fit" />}
				</div>

				{drop.featured.length > 0 && (
					<div>
						<SectionLabel>Featured</SectionLabel>
						<div className="grid grid-cols-2 gap-2">
							{drop.featured.map((it) => (
								<ShopCard key={it.key} item={it} />
							))}
						</div>
					</div>
				)}

				{drop.everyday.length > 0 && (
					<div>
						<SectionLabel>Everyday</SectionLabel>
						<div className="grid grid-cols-3 gap-2">
							{drop.everyday.map((it) => (
								<ShopCard key={it.key} item={it} small />
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
			{children}
		</div>
	);
}

function Thumb({ item, className }: { item: DropItem; className?: string }) {
	// suits → emoji tile; skins → color swatch; items → shop render (fallback swatch)
	if (item.emoji) {
		return (
			<div
				className={`flex items-center justify-center ${className}`}
				style={{ background: item.swatch ?? "#222" }}
			>
				<span className="text-4xl">{item.emoji}</span>
			</div>
		);
	}
	if (item.art) {
		return (
			<div
				className={`flex items-center justify-center overflow-hidden ${className} [background:repeating-conic-gradient(#161616_0%_25%,#1d1d1d_0%_50%)] [background-size:16px_16px]`}
			>
				<img
					src={item.art}
					alt={item.name}
					className="h-full w-full object-contain"
					onError={(e) => {
						const el = e.target as HTMLImageElement;
						el.style.display = "none";
						if (item.swatch && el.parentElement) el.parentElement.style.background = item.swatch;
					}}
				/>
			</div>
		);
	}
	return <div className={className} style={{ background: item.swatch ?? "#333" }} />;
}

function HeroCard({ item, label }: { item: DropItem; label: string }) {
	const r = rarityOf(item.cost);
	return (
		<div
			className="relative overflow-hidden rounded-2xl border p-2"
			style={{ borderColor: `${r.chip}66`, background: `${r.chip}12` }}
		>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">
					{label}
				</span>
				<span
					className="rounded-full px-1.5 py-0.5 text-[8px] font-bold"
					style={{ background: r.chip, color: "#1a1a1a" }}
				>
					{r.label}
				</span>
			</div>
			<Thumb item={item} className="aspect-square w-full rounded-xl" />
			<div className="mt-1.5 truncate text-xs font-semibold">{item.name}</div>
			{item.badge && <div className="text-[10px] text-neutral-400">{item.badge}</div>}
			<div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-amber-300">
				<span>🪙</span> {item.cost}
			</div>
		</div>
	);
}

function ShopCard({ item, small }: { item: DropItem; small?: boolean }) {
	const r = rarityOf(item.cost);
	return (
		<div className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950/40 p-1.5">
			<Thumb item={item} className="aspect-square w-full rounded-lg" />
			<div className={`mt-1 truncate font-medium ${small ? "text-[10px]" : "text-xs"}`}>
				{item.name}
			</div>
			<div className="flex items-center justify-between">
				<span className="flex items-center gap-0.5 text-[11px] font-bold text-amber-300">
					🪙 {item.cost}
				</span>
				<span className="h-2 w-2 rounded-full" style={{ background: r.chip }} title={r.label} />
			</div>
		</div>
	);
}

// The merchandising rules + this drop's tier breakdown (the "control" surface).
function DropRules({ drop }: { drop: Drop }) {
	const tiers = [
		{ label: "Today's Skin", n: drop.skin ? 1 : 0, want: "×1", note: "identity flex — aspirational" },
		{ label: "Hero Fit", n: drop.suit ? 1 : 0, want: "×1", note: "big suit / onesie — the wow" },
		{ label: "Featured", n: drop.featured.length, want: "×2", note: "standout accessories — rare" },
		{ label: "Everyday", n: drop.everyday.length, want: "×4–6", note: "tees / shoes — cheap, habit" },
	];
	return (
		<div className="space-y-4">
			<div className="rounded-2xl border border-white/10 bg-neutral-900/50 p-4">
				<h2 className="text-sm font-bold">Drop composition</h2>
				<p className="mt-0.5 text-[11px] text-neutral-500">
					One hero of each kind keeps scarcity; the price ladder keeps everyone buying.
				</p>
				<div className="mt-3 space-y-1.5">
					{tiers.map((t) => (
						<div key={t.label} className="flex items-center gap-3 text-xs">
							<span className="w-24 shrink-0 font-semibold">{t.label}</span>
							<span className="w-14 shrink-0 tabular-nums text-neutral-400">
								{t.n} <span className="text-neutral-600">/ {t.want}</span>
							</span>
							<span className="text-neutral-500">{t.note}</span>
						</div>
					))}
				</div>
			</div>

			<div className="rounded-2xl border border-white/10 bg-neutral-900/50 p-4">
				<h2 className="text-sm font-bold">Rarity ladder</h2>
				<div className="mt-2 flex flex-wrap gap-2">
					{RARITIES.map((r) => (
						<span
							key={r.label}
							className="flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-1 text-[11px]"
						>
							<span className="h-2.5 w-2.5 rounded-full" style={{ background: r.chip }} />
							{r.label}
							<span className="text-neutral-500">≥{r.min}🪙</span>
						</span>
					))}
				</div>
			</div>

			<div className="rounded-2xl border border-white/10 bg-neutral-900/50 p-4 text-[11px] leading-5 text-neutral-500">
				<h2 className="mb-1 text-sm font-bold text-white">Retention levers</h2>
				Daily rotation + a Tomorrow preview drive FOMO and anticipation. Always one aspirational
				hero and always something cheap so new and invested players both engage. Next: wire the
				controls here to actually pin/curate a drop and push it to the server.
			</div>
		</div>
	);
}

// Full catalog the drop draws from, grouped by pool.
function CatalogView({
	skins,
	suits,
	items,
}: {
	skins: DropItem[];
	suits: DropItem[];
	items: DropItem[];
}) {
	const featured = items.filter((i) => i.cost >= 60);
	const everyday = items.filter((i) => i.cost < 60);
	const groups: { title: string; note: string; list: DropItem[] }[] = [
		{ title: "Skins", note: "materials.json — hero-skin pool", list: skins },
		{ title: "Hero Fits", note: "suits / onesies (mock — no art yet)", list: suits },
		{ title: "Featured accessories", note: "≥60🪙 — rare pool", list: featured },
		{ title: "Everyday", note: "<60🪙 — tees / shoes / basics", list: everyday },
	];
	return (
		<div className="space-y-8">
			{groups.map((g) => (
				<div key={g.title}>
					<div className="mb-2 flex items-baseline gap-3">
						<h2 className="text-sm font-bold">{g.title}</h2>
						<span className="text-[11px] text-neutral-500">
							{g.list.length} · {g.note}
						</span>
					</div>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
						{g.list.map((it) => (
							<ShopCard key={it.key} item={it} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}
