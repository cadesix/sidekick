import {
  type Cadence,
  type CosmeticDefinition,
  type CosmeticSlot,
  type CosmeticSource,
  type Rarity,
  COSMETIC_CATALOG,
} from "@sidekick/shared";

/** Rarity → label + accent color (07 §6/§10). Legendary gets the glow tier. */
export const RARITY_STYLE: Record<Rarity, { label: string; color: string }> = {
  common: { label: "Common", color: "rgba(17,17,17,0.55)" },
  rare: { label: "Rare", color: "#9DC4F2" },
  epic: { label: "Epic", color: "#C79BE0" },
  legendary: { label: "Legendary", color: "#F2C94C" },
};

/** The wearable slot tabs in the locker, in display order (07 §10). */
export const SLOT_TABS: { slot: CosmeticSlot; label: string }[] = [
  { slot: "head", label: "Head" },
  { slot: "face", label: "Face" },
  { slot: "outfit", label: "Outfit" },
  { slot: "accessory", label: "Acc" },
];

/** How a still-locked item is earned — the caption under a locked tile (07 §10). */
export function earnCaption(source: CosmeticSource): string {
  if (source === "streak") {
    return "streak reward";
  }
  if (source === "spinner") {
    return "from the spinner";
  }
  if (source === "event") {
    return "special drop";
  }
  return "starter";
}

export function catalogForSlot(slot: CosmeticSlot): CosmeticDefinition[] {
  return COSMETIC_CATALOG.filter((c) => c.slot === slot);
}

/** Human phrase for an action-item cadence (goal detail summary, 07 §4). */
export function cadenceLabel(cadence: Cadence | null): string {
  if (!cadence) {
    return "no set cadence";
  }
  if (cadence.type === "daily") {
    return "every day";
  }
  if (cadence.type === "weekly") {
    return `${cadence.target}× a week`;
  }
  return `${cadence.criteria.replace(/-/g, " ")} ${cadence.value}`;
}
