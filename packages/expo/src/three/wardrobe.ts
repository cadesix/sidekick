import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Manifest } from './cosmetics-manifest';

// Ported from sidekick/src/components/sidekick-wardrobe.ts (localStorage →
// AsyncStorage, so load is async; the renderer awaits it before dressing).
// The Shop's saved outfit: for each dressable slot we remember whether it's
// worn, which patterned variant is selected, and an optional solid-color
// override (which replaces the variant's texture).

// slots the Shop lets you dress (phone is a prop, handled separately)
export const WARDROBE_SLOTS = ['shirt', 'pants', 'hat', 'shoes'] as const;
export type WardrobeSlot = (typeof WARDROBE_SLOTS)[number];

export const SLOT_LABEL: Record<WardrobeSlot, string> = {
  shirt: 'Shirt',
  pants: 'Pants',
  hat: 'Hat',
  shoes: 'Shoes',
};

export type SlotState = {
  equipped: boolean;
  variantId?: string; // selected patterned variant
  color?: string; // solid-color override; when set it replaces the pattern
};
export type Wardrobe = Record<WardrobeSlot, SlotState>;

// same key as the web's localStorage entry
const KEY = 'sidekick-wardrobe-v1';

// starts dressed in just the default shirt, like the current hero
export const DEFAULT_WARDROBE: Wardrobe = {
  shirt: { equipped: true, variantId: 'sky' },
  pants: { equipped: false },
  hat: { equipped: false },
  shoes: { equipped: false },
};

// Hermes may lack structuredClone; the wardrobe is plain JSON anyway.
export const cloneWardrobe = (w: Wardrobe): Wardrobe => JSON.parse(JSON.stringify(w));

export async function loadWardrobe(): Promise<Wardrobe> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return cloneWardrobe(DEFAULT_WARDROBE);
    const saved = JSON.parse(raw) as Partial<Wardrobe>;
    const merged = cloneWardrobe(DEFAULT_WARDROBE);
    for (const slot of WARDROBE_SLOTS) {
      if (saved[slot]) merged[slot] = { ...merged[slot], ...saved[slot] };
    }
    return merged;
  } catch {
    return cloneWardrobe(DEFAULT_WARDROBE);
  }
}

export function saveWardrobe(w: Wardrobe): void {
  AsyncStorage.setItem(KEY, JSON.stringify(w)).catch(() => {
    // ignore storage failures (matches the web's quota/private-mode swallow)
  });
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

// A tidy palette of solid colors offered for every slot.
export const SHOP_COLORS: string[] = [
  '#e7ebef', // off-white
  '#3a3f47', // charcoal
  '#e4553b', // tomato
  '#f2913d', // orange
  '#f4c634', // sunflower
  '#5fbf6a', // grass
  '#2f9e8f', // teal
  '#4a8fe0', // sky
  '#3d5bd6', // royal
  '#8a63d2', // violet
  '#e069a8', // pink
  '#7a5a3c', // cocoa
];
