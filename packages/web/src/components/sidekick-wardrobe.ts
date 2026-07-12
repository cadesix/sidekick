import type { Manifest } from "./sidekick-equipment";

// The Shop's saved outfit. For each dressable slot we remember whether it's worn,
// which patterned variant is selected, and an optional solid-color override
// (which replaces the variant's texture). Persisted so the character keeps its
// outfit across reloads; the canvas applies it on mount and the Shop drives it live.

// slots the Shop lets you dress (phone is a prop, handled separately)
export const WARDROBE_SLOTS = ["shirt", "pants", "hat", "shoes"] as const;
export type WardrobeSlot = (typeof WARDROBE_SLOTS)[number];

export const SLOT_LABEL: Record<WardrobeSlot, string> = {
	shirt: "Shirt",
	pants: "Pants",
	hat: "Hat",
	shoes: "Shoes",
};

export type SlotState = {
	equipped: boolean;
	variantId?: string; // selected patterned variant
	color?: string; // solid-color override; when set it replaces the pattern
};
export type Wardrobe = Record<WardrobeSlot, SlotState>;

const KEY = "sidekick-wardrobe-v1";

// starts dressed in just the default shirt, like the current hero
export const DEFAULT_WARDROBE: Wardrobe = {
	shirt: { equipped: true, variantId: "sky" },
	pants: { equipped: false },
	hat: { equipped: false },
	shoes: { equipped: false },
};

export function loadWardrobe(): Wardrobe {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return structuredClone(DEFAULT_WARDROBE);
		const saved = JSON.parse(raw) as Partial<Wardrobe>;
		const merged = structuredClone(DEFAULT_WARDROBE);
		for (const slot of WARDROBE_SLOTS) {
			if (saved[slot]) merged[slot] = { ...merged[slot], ...saved[slot] };
		}
		return merged;
	} catch {
		return structuredClone(DEFAULT_WARDROBE);
	}
}

export function saveWardrobe(w: Wardrobe): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(w));
	} catch {
		// ignore quota / private-mode failures
	}
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
	"#e7ebef", // off-white
	"#3a3f47", // charcoal
	"#e4553b", // tomato
	"#f2913d", // orange
	"#f4c634", // sunflower
	"#5fbf6a", // grass
	"#2f9e8f", // teal
	"#4a8fe0", // sky
	"#3d5bd6", // royal
	"#8a63d2", // violet
	"#e069a8", // pink
	"#7a5a3c", // cocoa
];
