// Shop catalog + daily-rotation logic, ported from the web's shop-sheet.tsx and
// made platform-agnostic. ZERO DOM / RN imports: the app hands in its cosmetics
// catalog (slots, labels, colors, manifest) and this computes the purchasable
// products, their prices, rarity tiers, and the date-seeded "Today's Shop".
//
// The two apps share these numbers so a shirt costs the same and the daily
// restock picks the same items on web and native (given the same date seed).

import { hashStr, mulberry32 } from './rng';
import shopCatalogJson from './shop-catalog.json';

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

// display names for the solid-color editions, keyed by the shop palette hex
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
  RARITIES.find((r) => cost >= r.min) ?? RARITIES[RARITIES.length - 1];

// ---- catalog inputs (structural, provided by the app) -----------------------

// A texture ref is a URL string (web) or a Metro module number (native); we
// keep it opaque so this stays platform-agnostic.
export type TexRef = string | number;

export type ShopVariant = {
  id: string;
  name: string;
  tex?: TexRef;
  color?: string;
};
export type ShopSlotDef = { variants: ShopVariant[] };
export type ShopManifest = Record<string, ShopSlotDef>;

// Everything the app passes in to build the catalog: which slots to offer, their
// display labels, the solid-color palette, and the manifest of variants.
export type ShopCatalog = {
  slots: readonly string[];
  slotLabel: Record<string, string>;
  colors: readonly string[];
  manifest: ShopManifest;
};

// ---- products ---------------------------------------------------------------

// one concrete purchasable: a textured variant edition or a solid-color edition.
// renderKey doubles as the inventory / render-art key:
//   `${slot}-${variantId}`  or  `${slot}-c${hexWithoutHash}`
export type Product = {
  slot: string;
  variantId?: string;
  color?: string;
  name: string;
  cost: number;
  renderKey: string;
  tex?: TexRef; // source texture (for the tinted fallback art)
  tint?: string; // solid-color editions only
};

export function buildProducts(catalog: ShopCatalog): Product[] {
  const { slots, slotLabel, colors, manifest } = catalog;
  const out: Product[] = [];
  for (const slot of slots) {
    const def = manifest[slot];
    if (!def) continue;
    const base = PRICE[slot] ?? DEFAULT_PRICE;
    const label = slotLabel[slot] ?? slot;
    // one product per textured variant, price stepping up by index
    def.variants.forEach((v, i) =>
      out.push({
        slot,
        variantId: v.id,
        name: `${v.name} ${label}`,
        cost: base + i * 5,
        renderKey: `${slot}-${v.id}`,
        tex: v.tex,
      }),
    );
    // one product per solid color, flat base price
    for (const c of colors)
      out.push({
        slot,
        color: c,
        name: `${COLOR_NAMES[c] ?? c} ${label}`,
        cost: base,
        renderKey: `${slot}-c${c.slice(1)}`,
        tex: def.variants[0]?.tex,
        tint: c,
      });
  }
  return out;
}

// ---- curated catalog --------------------------------------------------------

// The hand-curated inventory of what may appear / rotate in the shop. Authored
// in shop-catalog.json (committed source of truth), edited from the Asset
// Manager's "add to catalog" button. Each entry references one configured
// instance by its renderKey (the same `${slot}-${variantId}` / `${slot}-c${hex}`
// key the economy store and shop-render art use), so no migration is needed.
// buildProducts() expands the whole manifest × palette; buildCatalogProducts()
// gates that down to just these entries — the shop offers ONLY cataloged items.
export type CatalogEntry = {
  renderKey: string;
  slot: string; // manifest item key (e.g. "beanie"), not the mutual-exclusion group
  variantId?: string;
  color?: string;
};

export const SHOP_CATALOG: readonly CatalogEntry[] = shopCatalogJson as CatalogEntry[];

// The purchasable set, built DIRECTLY from the curated catalog (not by filtering
// the manifest×palette expansion) so a catalog entry can carry ANY color the
// Asset Manager's picker chose — not just the 12 palette swatches. This is what
// the shop UI and todaysShop() consume; buildProducts() alone offers everything.
export function buildCatalogProducts(catalog: ShopCatalog): Product[] {
  const { slotLabel, manifest } = catalog;
  const out: Product[] = [];
  for (const e of SHOP_CATALOG) {
    const def = manifest[e.slot];
    if (!def) continue;
    const base = PRICE[e.slot] ?? DEFAULT_PRICE;
    const label = slotLabel[e.slot] ?? e.slot;
    if (e.color) {
      out.push({
        slot: e.slot,
        color: e.color,
        name: `${COLOR_NAMES[e.color] ?? e.color} ${label}`,
        cost: base,
        renderKey: e.renderKey,
        tex: def.variants[0]?.tex,
        tint: e.color,
      });
    } else if (e.variantId) {
      const i = def.variants.findIndex((v) => v.id === e.variantId);
      if (i < 0) continue;
      const v = def.variants[i];
      out.push({
        slot: e.slot,
        variantId: v.id,
        name: `${v.name} ${label}`,
        cost: base + i * 5,
        renderKey: e.renderKey,
        tex: v.tex,
      });
    }
  }
  return out;
}

// ---- daily rotation ---------------------------------------------------------

// Seeded by the local date string so everyone's shop restocks at midnight and
// the picks are stable all day. Returns 2 premium FEATURED items (cost ≥ 60)
// plus a DAILY row of up to 4 more, one per slot, no repeats.
export function todaysShop(
  products: Product[],
  seed: string,
): { featured: Product[]; daily: Product[] } {
  const rng = mulberry32(hashStr(seed));
  const pool = [...products];
  // Fisher–Yates with the seeded rng
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
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
