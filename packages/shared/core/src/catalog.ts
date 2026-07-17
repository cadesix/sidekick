// The canonical cosmetics catalog: every dressable slot, its display label,
// its body region, and (from the generated catalog-variants module) its
// purchasable variants. Pure data — texture refs and asset paths live in the
// app layers — so the server builds the exact same shop product list the
// client shows, from this module alone.

import { CATALOG_VARIANTS } from './catalog-variants';
import type { CatalogSlotId, CatalogVariant } from './catalog-variants';

export type WardrobeSlot = CatalogSlotId;

// Everything sellable today is a cosmetic; 'consumable' is reserved for future
// entries (streak freezes, gifts, dyes) that share the catalog/shop/purchase path.
export type ProductKind = 'cosmetic' | 'consumable';

// slots the Shop lets you dress (phone is a prop, handled separately). The
// order is load-bearing: buildProducts emits products in this order, which the
// seeded daily rotation shuffles — reordering changes everyone's shop.
export const WARDROBE_SLOTS: readonly WardrobeSlot[] = [
  'shirt',
  'hoodie',
  'pants',
  'shorts',
  'hat',
  'beanie',
  'bucket',
  'wizard',
  'crown',
  'headphones',
  'earmuffs',
  'sweatband',
  'laurel',
  'propeller',
  'catbeanie',
  'cowboy',
  'shoes',
  'sneakers',
  'boots',
  'glasses',
  'stars',
  'goggles',
  'snorkel',
  'earring',
  'flower',
  'earbow',
  'scarf',
  'backpack',
];

export const SLOT_LABEL: Record<WardrobeSlot, string> = {
  shirt: 'Shirt',
  hoodie: 'Hoodie',
  pants: 'Pants',
  shorts: 'Shorts',
  hat: 'Cap',
  beanie: 'Beanie',
  bucket: 'Bucket Hat',
  wizard: 'Wizard Hat',
  crown: 'Crown',
  headphones: 'Headphones',
  earmuffs: 'Earmuffs',
  sweatband: 'Sweatband',
  laurel: 'Laurel Wreath',
  propeller: 'Propeller Cap',
  catbeanie: 'Cat Beanie',
  cowboy: 'Cowboy Hat',
  shoes: 'Shoes',
  sneakers: 'Sneakers',
  boots: 'Boots',
  glasses: 'Glasses',
  stars: 'Star Glasses',
  goggles: 'Ski Goggles',
  snorkel: 'Snorkel',
  earring: 'Earring',
  flower: 'Flower',
  earbow: 'Ear Bow',
  scarf: 'Scarf',
  backpack: 'Backpack',
};

// One worn item per body region — equipping a hoodie takes the shirt off, a
// crown replaces a beanie, etc. Eyes and back are their own regions so glasses
// and backpacks layer freely with everything else.
export type BodyRegion = 'torso' | 'legs' | 'head' | 'feet' | 'eyes' | 'ears' | 'neck' | 'back';

export const SLOT_REGION: Record<WardrobeSlot, BodyRegion> = {
  shirt: 'torso',
  hoodie: 'torso',
  pants: 'legs',
  shorts: 'legs',
  hat: 'head',
  beanie: 'head',
  bucket: 'head',
  wizard: 'head',
  crown: 'head',
  headphones: 'head',
  earmuffs: 'head',
  sweatband: 'head',
  laurel: 'head',
  propeller: 'head',
  catbeanie: 'head',
  cowboy: 'head',
  shoes: 'feet',
  sneakers: 'feet',
  boots: 'feet',
  glasses: 'eyes',
  stars: 'eyes',
  goggles: 'eyes',
  snorkel: 'eyes',
  earring: 'ears',
  flower: 'ears',
  earbow: 'ears',
  scarf: 'neck',
  backpack: 'back',
};

const byRegion: Partial<Record<BodyRegion, WardrobeSlot[]>> = {};
const regionGroups: WardrobeSlot[][] = [];
for (const slot of WARDROBE_SLOTS) {
  let group = byRegion[SLOT_REGION[slot]];
  if (!group) {
    group = [];
    byRegion[SLOT_REGION[slot]] = group;
    regionGroups.push(group);
  }
  group.push(slot);
}

export const REGIONS: readonly (readonly WardrobeSlot[])[] = regionGroups;

export function regionSiblings(slot: WardrobeSlot): WardrobeSlot[] {
  return WARDROBE_SLOTS.filter((s) => s !== slot && SLOT_REGION[s] === SLOT_REGION[slot]);
}

// the catalog in shop order: one entry per dressable slot
export type CatalogSlot = {
  kind: ProductKind;
  slot: WardrobeSlot;
  label: string;
  region: BodyRegion;
  variants: readonly CatalogVariant[];
};

export const CATALOG: readonly CatalogSlot[] = WARDROBE_SLOTS.map((slot) => ({
  kind: 'cosmetic',
  slot,
  label: SLOT_LABEL[slot],
  region: SLOT_REGION[slot],
  variants: CATALOG_VARIANTS[slot],
}));
