// Shop pricing + daily-rotation logic over the canonical catalog (./catalog).
// ZERO DOM / RN imports: this computes the purchasable products, their prices,
// rarity tiers, and the date-seeded "Today's Shop" from pure data, so the
// server and the client build the exact same product list (given the same
// date seed). The app may pass in its bundled texture refs purely for the
// tinted fallback art; the server passes nothing.

import { CATALOG } from './catalog';
import type { ProductKind, WardrobeSlot } from './catalog';
import { hashStr, mulberry32 } from './rng';

// per-item base price; textured variant editions step up from it (+5 per index),
// solid-color editions sell flat at the base. This map is the single tuning
// surface — rarity is derived from the resulting cost.
export const PRICE: Record<string, number> = {
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

// fallback for any slot missing from PRICE
const DEFAULT_PRICE = 40;

// display names for the solid-color editions, keyed by the shop palette hex;
// the key order IS the palette order shown in the shop
export const COLOR_NAMES: Record<string, string> = {
  '#e7ebef': 'Cloud',
  '#3a3f47': 'Charcoal',
  '#e4553b': 'Tomato',
  '#f2913d': 'Tangerine',
  '#f4c634': 'Sunflower',
  '#5fbf6a': 'Grass',
  '#2f9e8f': 'Teal',
  '#4a8fe0': 'Sky',
  '#3d5bd6': 'Royal',
  '#8a63d2': 'Violet',
  '#e069a8': 'Pink',
  '#7a5a3c': 'Cocoa',
};

// the tidy palette of solid colors offered for every slot
export const SHOP_COLORS: string[] = Object.keys(COLOR_NAMES);

// rarity tiers, derived from price so the price map stays the single knob.
// `grad` is a 2-stop pair (light → light) usable by web CSS gradients or an RN
// gradient / flat fill; `chip` is the badge color.
export type Rarity = {
  min: number;
  label: string;
  chip: string;
  grad: [string, string];
};

export const RARITIES: readonly Rarity[] = [
  { min: 200, label: 'Legendary', chip: '#d99e1b', grad: ['#fff6dc', '#ffe9ac'] },
  { min: 100, label: 'Epic', chip: '#8a63d2', grad: ['#f3edff', '#e3d5ff'] },
  { min: 60, label: 'Rare', chip: '#4a8fe0', grad: ['#ebf3ff', '#d6e7ff'] },
  { min: 0, label: 'Common', chip: '#9aa3ad', grad: ['#f6f8fa', '#eaeef2'] },
];

export const rarityOf = (cost: number): Rarity =>
  RARITIES.find((r) => cost >= r.min) ?? RARITIES[RARITIES.length - 1]!;

// ---- products ---------------------------------------------------------------

// A texture ref is a URL string (web) or a Metro module number (native); we
// keep it opaque so this stays platform-agnostic.
export type TexRef = string | number;

// one concrete purchasable: a textured variant edition or a solid-color edition.
// renderKey doubles as the inventory / render-art key:
//   `${slot}-${variantId}`  or  `${slot}-c${hexWithoutHash}`
export type Product = {
  kind: ProductKind;
  slot: WardrobeSlot;
  variantId?: string;
  color?: string;
  name: string;
  cost: number;
  renderKey: string;
  tex?: TexRef; // app-supplied source texture (for the tinted fallback art)
  tint?: string; // solid-color editions only
};

// `textures` is the app's optional art map, keyed by textured-variant renderKey
// (`${slot}-${variantId}`) — it only decorates Product.tex and never affects
// identity or pricing, so a server calling buildProducts() gets the exact same
// products (same renderKeys, names, costs) the client shows.
export function buildProducts(textures?: Record<string, TexRef>): Product[] {
  const out: Product[] = [];
  for (const { kind, slot, label, variants } of CATALOG) {
    const base = PRICE[slot] ?? DEFAULT_PRICE;
    // one product per textured variant, price stepping up by index
    variants.forEach((v, i) =>
      out.push({
        kind,
        slot,
        variantId: v.id,
        name: `${v.name} ${label}`,
        cost: base + i * 5,
        renderKey: `${slot}-${v.id}`,
        tex: textures?.[`${slot}-${v.id}`],
      }),
    );
    // one product per solid color, flat base price; fallback art tints the
    // first variant's texture
    let colorTex: TexRef | undefined;
    if (variants[0]) colorTex = textures?.[`${slot}-${variants[0].id}`];
    for (const c of SHOP_COLORS)
      out.push({
        kind,
        slot,
        color: c,
        name: `${COLOR_NAMES[c] ?? c} ${label}`,
        cost: base,
        renderKey: `${slot}-c${c.slice(1)}`,
        tex: colorTex,
        tint: c,
      });
  }
  return out;
}

// ---- daily rotation ---------------------------------------------------------

// Seeded by the local date string so everyone's shop restocks at midnight and
// the picks are stable all day. Returns 2 premium FEATURED items (cost ≥ 60)
// plus a DAILY row of up to 4 more, one per slot, no repeats.
export function todaysShop(
  products: readonly Product[],
  seed: string,
): { featured: Product[]; daily: Product[] } {
  const rng = mulberry32(hashStr(seed));
  const pool = [...products];
  // Fisher–Yates with the seeded rng
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  // featured leans premium; the daily row fills from the rest, one per slot
  const featured = pool.filter((p) => p.cost >= 60).slice(0, 2);
  const seen = new Set(featured.map((p) => p.slot));
  const daily: Product[] = [];
  for (const p of pool) {
    if (daily.length >= 4) break;
    if (featured.includes(p) || seen.has(p.slot)) continue;
    seen.add(p.slot);
    daily.push(p);
  }
  return { featured, daily };
}
