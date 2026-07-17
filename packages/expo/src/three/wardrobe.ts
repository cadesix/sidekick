import { WARDROBE_SLOTS } from '@sidekick/core';
import type { WardrobeSlot } from '@sidekick/core';

import { readMirror, WARDROBE_MIRROR_KEY, writeMirror } from '../lib/mirror';
import type { Manifest } from './cosmetics-manifest';

// The worn outfit: for each dressable slot we remember whether it's worn, which
// patterned variant is selected, and an optional solid-color override (which
// replaces the variant's texture). Since plan 20 the server owns the equipped
// set (`userCosmetics.equipped`); what persists here is only the user-scoped
// BOOT MIRROR of it (lib/mirror.ts), so the renderer can dress the character
// before any network. The snapshot reconciles + rewrites it (lib/wardrobe-sync.ts).

// Slots, labels, body-region exclusivity and the solid-color palette are
// canonical catalog data in @sidekick/core (the server enforces the same
// rules) — re-exported here so the renderer keeps one import site.
export { regionSiblings, SHOP_COLORS, SLOT_LABEL, WARDROBE_SLOTS } from '@sidekick/core';
export type { WardrobeSlot } from '@sidekick/core';

// How the wardrobe reads as Shop tabs: body regions top-to-toe, independent
// regions (glasses/backpack) merged into one Extras tab.
export const SHOP_CATEGORIES: { id: string; label: string; slots: WardrobeSlot[] }[] = [
  { id: 'tops', label: 'Tops', slots: ['shirt', 'hoodie'] },
  { id: 'bottoms', label: 'Bottoms', slots: ['pants', 'shorts'] },
  {
    id: 'head',
    label: 'Head',
    slots: ['hat', 'beanie', 'bucket', 'wizard', 'crown', 'headphones', 'earmuffs', 'sweatband', 'laurel', 'propeller', 'catbeanie', 'cowboy'],
  },
  { id: 'feet', label: 'Feet', slots: ['shoes', 'sneakers', 'boots'] },
  {
    id: 'extras',
    label: 'Extras',
    slots: ['glasses', 'stars', 'goggles', 'snorkel', 'earring', 'flower', 'earbow', 'scarf', 'backpack'],
  },
];

export type SlotState = {
  equipped: boolean;
  variantId?: string; // selected patterned variant
  color?: string; // solid-color override; when set it replaces the pattern
};
export type Wardrobe = Record<WardrobeSlot, SlotState>;

// bumped whenever the persisted Wardrobe shape changes; a mismatched mirror is ignored
const WARDROBE_SCHEMA_VERSION = 1;

// starts dressed in just the default shirt, like the current hero
export const DEFAULT_WARDROBE: Wardrobe = Object.fromEntries(
  WARDROBE_SLOTS.map((s) => [s, s === 'shirt' ? { equipped: true, variantId: 'sky' } : { equipped: false }]),
) as Wardrobe;

// Hermes may lack structuredClone; the wardrobe is plain JSON anyway.
export const cloneWardrobe = (w: Wardrobe): Wardrobe => JSON.parse(JSON.stringify(w));

export async function loadWardrobe(): Promise<Wardrobe> {
  const saved = await readMirror<Partial<Wardrobe>>(WARDROBE_MIRROR_KEY, WARDROBE_SCHEMA_VERSION);
  const merged = cloneWardrobe(DEFAULT_WARDROBE);
  if (!saved) return merged;
  for (const slot of WARDROBE_SLOTS) {
    if (saved[slot]) merged[slot] = { ...merged[slot], ...saved[slot] };
  }
  return merged;
}

export function saveWardrobe(w: Wardrobe): void {
  writeMirror(WARDROBE_MIRROR_KEY, WARDROBE_SCHEMA_VERSION, w);
}

// Imperative handle the canvas hands to React so the Shop can dress the live
// character. Each mutation applies to the 3D scene AND persists the wardrobe.
export type CosmeticsControls = {
  manifest: () => Manifest;
  getState: () => Wardrobe;
  // equip / switch to a patterned variant (clears any color override)
  equipVariant: (slot: WardrobeSlot, variantId: string) => void;
  // apply a solid color (equips the slot first if it was off)
  setColor: (slot: WardrobeSlot, color: string) => void;
  // take the slot off
  remove: (slot: WardrobeSlot) => void;
};
