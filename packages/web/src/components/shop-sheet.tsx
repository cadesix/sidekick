import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { LuX, LuCheck, LuClock3 } from "react-icons/lu";
import type { Manifest } from "./sidekick-equipment";
import { ItemTurntable } from "./item-turntable";
import { addToInventory, loadCoins, loadInventory, spendCoins, subscribeCoins } from "./sidekick-economy";
import {
	SLOT_LABEL,
	SHOP_COLORS,
	WARDROBE_SLOTS,
	type WardrobeSlot,
	type Wardrobe,
	type CosmeticsControls,
} from "./sidekick-wardrobe";

// Near-full-screen Shop, shaped after the retention patterns of Fortnite /
// Animal Crossing / Finch: a date-seeded "Today's Shop" up top (two FEATURED
// products + a daily row that restocks at local midnight, with a countdown),
// rarity tiers (price-derived) giving cards their color identity, and the full
// catalog below as one flat run of h-scroll shelves (one per item, no sorting
// UI). Rotation is novelty-framed, not loss-framed ("new stock in…"), per the
// wholesome references. Tapping a
// product opens a detail modal (big turntable, price, Buy) — purchases deplete
// the coin balance and land in the inventory; equipping owned items lives in
// the Appearance sheet (avatar button, top right).

// per-item base price; variant editions step up from it, color editions sell flat
const PRICE: Record<WardrobeSlot, number> = {
	shirt: 25,
	hoodie: 60,
	pants: 30,
	shorts: 25,
	hat: 40,
	beanie: 35,
	bucket: 45,
	wizard: 120,
	crown: 250,
	shoes: 45,
	sneakers: 70,
	boots: 80,
	glasses: 50,
	headphones: 85,
	earmuffs: 55,
	sweatband: 30,
	laurel: 150,
	propeller: 65,
	catbeanie: 60,
	cowboy: 75,
	stars: 65,
	goggles: 70,
	snorkel: 60,
	earring: 40,
	flower: 30,
	earbow: 30,
	scarf: 45,
	backpack: 90,
};

// display names for the solid-color editions
const COLOR_NAMES: Record<string, string> = {
	"#e7ebef": "Cloud",
	"#3a3f47": "Charcoal",
	"#e4553b": "Tomato",
	"#f2913d": "Tangerine",
	"#f4c634": "Sunflower",
	"#5fbf6a": "Grass",
	"#2f9e8f": "Teal",
	"#4a8fe0": "Sky",
	"#3d5bd6": "Royal",
	"#8a63d2": "Violet",
	"#e069a8": "Pink",
	"#7a5a3c": "Cocoa",
};

// rarity tiers, derived from price so the map stays the single tuning surface
const RARITIES = [
	{ min: 200, label: "Legendary", chip: "#d99e1b", grad: "linear-gradient(160deg,#fff6dc,#ffe9ac)" },
	{ min: 100, label: "Epic", chip: "#8a63d2", grad: "linear-gradient(160deg,#f3edff,#e3d5ff)" },
	{ min: 60, label: "Rare", chip: "#4a8fe0", grad: "linear-gradient(160deg,#ebf3ff,#d6e7ff)" },
	{ min: 0, label: "Common", chip: "#9aa3ad", grad: "linear-gradient(160deg,#f6f8fa,#eaeef2)" },
] as const;
const rarityOf = (cost: number) => RARITIES.find((r) => cost >= r.min) ?? RARITIES[3];

// one concrete purchasable: a textured variant or a solid-color edition
export type Product = {
	slot: WardrobeSlot;
	variantId?: string;
	color?: string;
	name: string;
	cost: number;
	renderKey: string;
	img?: string;
	tint?: string;
};

export function buildProducts(manifest: Manifest): Product[] {
	const out: Product[] = [];
	for (const slot of WARDROBE_SLOTS) {
		const def = manifest[slot];
		if (!def) continue;
		def.variants.forEach((v, i) =>
			out.push({
				slot,
				variantId: v.id,
				name: `${v.name} ${SLOT_LABEL[slot]}`,
				cost: PRICE[slot] + i * 5,
				renderKey: `${slot}-${v.id}`,
				img: v.tex,
			}),
		);
		for (const c of SHOP_COLORS)
			out.push({
				slot,
				color: c,
				name: `${COLOR_NAMES[c] ?? c} ${SLOT_LABEL[slot]}`,
				cost: PRICE[slot],
				renderKey: `${slot}-c${c.slice(1)}`,
				img: def.variants[0]?.tex,
				tint: c,
			});
	}
	return out;
}

// ---- daily rotation: seeded by the local date so everyone's shop restocks at
// midnight and the picks are stable all day ------------------------------------
function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function hashStr(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
	return h >>> 0;
}
function todaysShop(products: Product[]): { featured: Product[]; daily: Product[] } {
	const rng = mulberry32(hashStr(new Date().toDateString()));
	const pool = [...products];
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	// featured leans premium; the daily row fills from the rest, one per slot
	const featured = pool.filter((p) => p.cost >= 60).slice(0, 2);
	const seen = new Set(featured.map((p) => p.slot as string));
	const daily: Product[] = [];
	for (const p of pool) {
		if (daily.length >= 4) break;
		if (featured.includes(p) || seen.has(p.slot)) continue;
		seen.add(p.slot);
		daily.push(p);
	}
	return { featured, daily };
}

// Product art: prefer the real render from /item-render (public/shop-renders),
// fall back to the raw fabric texture (tinted for color editions).
export function ProductImage({ p, className }: { p: Product; className?: string }) {
	const [hasRender, setHasRender] = useState(true);
	if (hasRender) {
		return (
			<img
				src={`/shop-renders/${p.renderKey}.png`}
				alt=""
				loading="lazy"
				draggable={false}
				onError={() => setHasRender(false)}
				className={`${className ?? ""} object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.18)]`}
			/>
		);
	}
	return (
		<span className={`relative block overflow-hidden rounded-2xl ${className ?? ""}`}>
			{p.img ? (
				<img
					src={p.img}
					alt=""
					loading="lazy"
					draggable={false}
					className={`h-full w-full object-cover ${p.tint ? "brightness-110 grayscale" : ""}`}
				/>
			) : null}
			{p.tint ? <span className="absolute inset-0 mix-blend-multiply" style={{ background: p.tint }} /> : null}
		</span>
	);
}

export function Coin({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 16 16" className={className}>
			<circle cx="8" cy="8" r="7" fill="#f4c634" />
			<circle cx="8" cy="8" r="7" fill="none" stroke="#d99e1b" strokeWidth="1.6" />
			<circle cx="8" cy="8" r="4.2" fill="none" stroke="#d99e1b" strokeWidth="1.2" />
		</svg>
	);
}

export function ShopSheet({
	open,
	onClose,
	controlsRef,
}: {
	open: boolean;
	onClose: () => void;
	controlsRef: MutableRefObject<CosmeticsControls | null>;
}) {
	const [detail, setDetail] = useState<Product | null>(null);
	const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);
	const [manifest, setManifest] = useState<Manifest | null>(null);
	const [coins, setCoins] = useState(loadCoins);
	const [inventory, setInventory] = useState<Set<string>>(loadInventory);
	useEffect(() => subscribeCoins(setCoins), []);

	// snapshot outfit + catalog + balances when the sheet opens
	useEffect(() => {
		if (!open) return;
		setDetail(null);
		setCoins(loadCoins());
		setInventory(loadInventory());
		const c = controlsRef.current;
		if (!c) return;
		setWardrobe(c.getState());
		setManifest(c.manifest());
	}, [open, controlsRef]);

	// countdown to the midnight restock (ticks while open)
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!open) return;
		setNow(Date.now());
		const t = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(t);
	}, [open]);
	const midnight = new Date();
	midnight.setHours(24, 0, 0, 0);
	const minsLeft = Math.max(0, Math.floor((midnight.getTime() - now) / 60_000));
	const restockIn = `${Math.floor(minsLeft / 60)}h ${String(minsLeft % 60).padStart(2, "0")}m`;

	const products = useMemo(() => (manifest ? buildProducts(manifest) : []), [manifest]);
	const { featured, daily } = useMemo(() => todaysShop(products), [products]);

	const sync = () => {
		const c = controlsRef.current;
		if (c) setWardrobe(c.getState());
	};
	const isWorn = (p: Product) => {
		const st = wardrobe?.[p.slot];
		if (!st?.equipped) return false;
		return p.variantId ? st.variantId === p.variantId && !st.color : st.color?.toLowerCase() === p.color?.toLowerCase();
	};
	const owns = (p: Product) => inventory.has(p.renderKey);
	const wear = (p: Product) => {
		const c = controlsRef.current;
		if (!c) return;
		if (p.variantId) c.equipVariant(p.slot, p.variantId);
		else if (p.color) c.setColor(p.slot, p.color);
		sync();
	};
	const buy = (p: Product) => {
		if (!spendCoins(p.cost)) return;
		addToInventory(p.renderKey);
		setInventory(loadInventory());
	};

	const priceOrOwned = (p: Product) =>
		owns(p) ? (
			<span className="text-[12px] font-bold text-emerald-600">Owned</span>
		) : (
			<span className="flex items-center gap-1">
				<Coin className="h-3.5 w-3.5" />
				<span className="text-[12px] font-bold tabular-nums text-neutral-600">{p.cost}</span>
			</span>
		);
	const wornBadge = (
		<span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-neutral-900">
			<LuCheck className="h-4 w-4 text-white" strokeWidth={3} />
		</span>
	);

	const shelf = (slot: WardrobeSlot, pool: Product[]) => {
		const items = pool.filter((p) => p.slot === slot);
		if (!items.length) return null;
		return (
			<div key={slot} className="pt-8">
				<div className="mb-3 text-[17px] font-extrabold leading-tight text-neutral-900">{SLOT_LABEL[slot]}</div>
				<div className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6">
					{items.map((p) => (
						<button key={p.renderKey} onClick={() => setDetail(p)} className="w-[128px] shrink-0 text-left">
							<div className="relative aspect-square w-full">
								<ProductImage p={p} className="h-full w-full" />
								{isWorn(p) ? (
									<span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-neutral-900">
										<LuCheck className="h-3.5 w-3.5 text-white" strokeWidth={3} />
									</span>
								) : null}
							</div>
							<div className="mt-1.5 truncate text-[12px] font-semibold text-neutral-700">{p.name}</div>
							{priceOrOwned(p)}
						</button>
					))}
				</div>
			</div>
		);
	};

	const detailWorn = detail ? isWorn(detail) : false;
	const detailOwned = detail ? owns(detail) : false;
	const canAfford = detail ? coins >= detail.cost : false;

	return (
		<div
			className={`absolute inset-x-0 bottom-0 z-40 h-[92%] transition-transform duration-300 ease-out ${
				open ? "translate-y-0" : "pointer-events-none translate-y-full"
			}`}
		>
			<div className="relative flex h-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.22)]">
				{/* grabber + header with the live coin balance */}
				<div className="relative shrink-0 px-5 pt-3">
					<div className="mx-auto h-1.5 w-10 rounded-full bg-neutral-200" />
					<div className="mt-2 flex items-center justify-between">
						<div className="text-[22px] font-extrabold text-neutral-900">Shop</div>
						<div className="flex items-center gap-3">
							<div className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 shadow-[0_2px_0_rgba(0,0,0,0.08)]">
								<Coin className="h-4 w-4" />
								<span className="text-[14px] font-extrabold tabular-nums text-neutral-800">{coins}</span>
							</div>
							<button
								onClick={onClose}
								aria-label="Close shop"
								className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-500 active:bg-neutral-200"
							>
								<LuX className="h-5 w-5" strokeWidth={2.5} />
							</button>
						</div>
					</div>
				</div>

				<div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-[max(env(safe-area-inset-bottom),20px)]">
							{/* ---- Today's Shop: featured + daily rotation ---- */}
							<div className="mt-3 flex items-center justify-between">
								<div className="text-[16px] font-extrabold text-neutral-900">Today's Shop</div>
								<div className="flex items-center gap-1.5 rounded-full bg-[#fff1e6] px-2.5 py-1 text-[12px] font-bold text-[#ff7a3d]">
									<LuClock3 className="h-3.5 w-3.5" strokeWidth={2.5} />
									New stock in {restockIn}
								</div>
							</div>

							<div className="mt-3 grid grid-cols-2 gap-3.5">
								{featured.map((p) => {
									const r = rarityOf(p.cost);
									return (
										<button
											key={p.renderKey}
											onClick={() => setDetail(p)}
											className="relative rounded-[24px] p-4 text-left shadow-[0_4px_0_rgba(0,0,0,0.10)] transition-all duration-100 active:translate-y-[2px] active:shadow-[0_2px_0_rgba(0,0,0,0.10)]"
											style={{ background: r.grad }}
										>
											<span
												className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white"
												style={{ background: r.chip }}
											>
												{r.label}
											</span>
											{open ? (
												<ItemTurntable
													slot={p.slot}
													variantId={p.variantId}
													color={p.color}
													className="mx-auto mt-1 h-36 w-36"
												/>
											) : (
												<ProductImage p={p} className="mx-auto mt-1 h-36 w-36" />
											)}
											<div className="mt-2 truncate text-[14px] font-bold text-neutral-900">{p.name}</div>
											{priceOrOwned(p)}
											{isWorn(p) ? wornBadge : null}
										</button>
									);
								})}
							</div>

							<div className="mt-3.5 grid grid-cols-2 gap-3.5">
								{daily.map((p) => {
									const r = rarityOf(p.cost);
									return (
										<button
											key={p.renderKey}
											onClick={() => setDetail(p)}
											className="relative rounded-[20px] p-3 text-left shadow-[0_3px_0_rgba(0,0,0,0.08)] transition-all duration-100 active:translate-y-[2px] active:shadow-[0_1px_0_rgba(0,0,0,0.08)]"
											style={{ background: r.grad }}
										>
											<ProductImage p={p} className="mx-auto h-24 w-24" />
											<div className="mt-1.5 truncate text-[12px] font-bold text-neutral-800">{p.name}</div>
											{priceOrOwned(p)}
											{isWorn(p) ? (
												<span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-neutral-900">
													<LuCheck className="h-3.5 w-3.5 text-white" strokeWidth={3} />
												</span>
											) : null}
										</button>
									);
								})}
							</div>

					{/* ---- full catalog: one shelf per item, all on one screen ---- */}
					<div className="mt-9 text-[20px] font-extrabold text-neutral-900">Browse all</div>
					{WARDROBE_SLOTS.map((slot) => shelf(slot, products))}
				</div>

				{/* ---- item detail: big turntable, price, buy → equip ---- */}
				<div
					className={`absolute inset-0 z-50 grid place-items-center transition-all duration-200 ease-out ${
						detail ? "opacity-100" : "pointer-events-none opacity-0"
					}`}
				>
					<button
						type="button"
						aria-label="Dismiss"
						onClick={() => setDetail(null)}
						className="absolute inset-0 bg-black/40"
					/>
					{detail ? (
						<div className="relative mx-8 w-[calc(100%-4rem)] max-w-sm rounded-[28px] bg-white p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
							<div className="rounded-[22px] p-3" style={{ background: rarityOf(detail.cost).grad }}>
								<span
									className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white"
									style={{ background: rarityOf(detail.cost).chip }}
								>
									{rarityOf(detail.cost).label}
								</span>
								<ItemTurntable
									key={detail.renderKey}
									slot={detail.slot}
									variantId={detail.variantId}
									color={detail.color}
									className="mx-auto h-52 w-52"
								/>
							</div>
							<div className="mt-4 text-center text-[20px] font-extrabold text-neutral-900">{detail.name}</div>
							{detailOwned ? (
								detailWorn ? (
									<button
										onClick={() => {
											controlsRef.current?.remove(detail.slot);
											sync();
										}}
										className="mt-4 flex w-full items-center justify-center rounded-full bg-neutral-100 py-3.5 text-[15px] font-bold text-neutral-600 shadow-[0_4px_0_rgba(0,0,0,0.10)] transition-all duration-100 active:translate-y-[3px] active:shadow-[0_1px_0_rgba(0,0,0,0.10)]"
									>
										Take off
									</button>
								) : (
									<button
										onClick={() => wear(detail)}
										className="mt-4 flex w-full items-center justify-center rounded-full bg-[#0a84ff] py-3.5 text-[15px] font-bold text-white shadow-[0_4px_0_#0868c8] transition-all duration-100 active:translate-y-[3px] active:shadow-[0_1px_0_#0868c8]"
									>
										Equip
									</button>
								)
							) : (
								<>
									<button
										onClick={() => buy(detail)}
										disabled={!canAfford}
										className={`mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-bold transition-all duration-100 ${
											canAfford
												? "bg-[#7A5AF8] text-white shadow-[0_4px_0_#5638c6] active:translate-y-[3px] active:shadow-[0_1px_0_#5638c6]"
												: "bg-neutral-100 text-neutral-400"
										}`}
									>
										<Coin className="h-4 w-4" />
										Buy for {detail.cost}
									</button>

								</>
							)}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
