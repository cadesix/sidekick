import type { QueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { regionSiblings, type Product } from '@sidekick/core';

import { equipCosmetic, unequipCosmetic, type Snapshot } from './api';
import { PRODUCTS } from './products';
import { patchSnapshot, SNAPSHOT_QUERY_KEY } from './state';
import {
  cloneWardrobe,
  saveWardrobe,
  WARDROBE_SLOTS,
  type CosmeticsControls,
  type SlotState,
  type Wardrobe,
} from '../three/wardrobe';

// Keeps the three parties of decision 10 in step: the live 3D scene (via
// CosmeticsControls, which also writes the boot mirror), the server (equip/
// unequip mutations), and the snapshot cache. Equips apply to the scene
// immediately, then fire the mutation; on failure the scene + mirror roll back
// to the pre-equip state (the last server-approved outfit) and the error
// surfaces like other failures. When a fresh snapshot lands, the equipped set
// overwrites the scene and the mirror (reconcileWardrobe).

const PRODUCT_BY_KEY = new Map(PRODUCTS.map((p) => [p.renderKey, p]));

type InventoryItem = Snapshot['inventory'][number];

function slotsEqual(a: SlotState, b: SlotState): boolean {
  if (a.equipped !== b.equipped) return false;
  if (!a.equipped) return true;
  return a.variantId === b.variantId && (a.color ?? null) === (b.color ?? null);
}

// Dress the scene to `target`, slot by slot. Each controls call also persists
// the mirror. Returns whether anything visibly changed (callers regenerate the
// head avatar only then).
function applyWardrobe(controls: CosmeticsControls, target: Wardrobe): boolean {
  let changed = false;
  const current = controls.getState();
  for (const slot of WARDROBE_SLOTS) {
    const next = target[slot];
    if (slotsEqual(current[slot], next)) continue;
    if (!next.equipped) {
      controls.remove(slot);
      changed = true;
    } else if (next.color) {
      if (next.variantId && next.variantId !== current[slot].variantId) {
        controls.equipVariant(slot, next.variantId);
      }
      controls.setColor(slot, next.color);
      changed = true;
    } else if (next.variantId) {
      controls.equipVariant(slot, next.variantId);
      changed = true;
    }
  }
  return changed;
}

// The server's equipped set as a Wardrobe: every equipped inventory row mapped
// through the catalog (renderKey → slot + variant/color). Unequipped slots keep
// `base`'s variant memory so re-equipping from the closet feels unchanged.
function wardrobeFromInventory(base: Wardrobe, inventory: InventoryItem[]): Wardrobe {
  const target = cloneWardrobe(base);
  for (const slot of WARDROBE_SLOTS) {
    target[slot] = { ...target[slot], equipped: false };
  }
  for (const item of inventory) {
    if (!item.equipped) continue;
    const product = PRODUCT_BY_KEY.get(item.itemKey);
    if (!product) continue;
    target[product.slot] = {
      equipped: true,
      variantId: product.variantId ?? target[product.slot].variantId,
      color: product.color,
    };
  }
  return target;
}

/**
 * Snapshot reconciliation: overwrite the scene with the server's equipped set
 * and rewrite the mirror (even on a no-op, so it carries this user's envelope).
 */
export function reconcileWardrobe(
  controls: CosmeticsControls,
  inventory: InventoryItem[],
): boolean {
  const target = wardrobeFromInventory(controls.getState(), inventory);
  const changed = applyWardrobe(controls, target);
  saveWardrobe(target);
  return changed;
}

// Patch the cached snapshot's equipped flags to what the scene now shows, under
// the mutation's stateVersion — so the next reconciliation is a no-op instead
// of reverting the scene to stale flags.
function patchEquippedFlags(
  queryClient: QueryClient,
  stateVersion: number,
  product: Product,
  equipped: boolean,
): void {
  const cached = queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY);
  if (!cached) return;
  const cleared = new Set<string>([product.slot, ...regionSiblings(product.slot)]);
  const inventory = cached.inventory.map((item) => {
    if (item.itemKey === product.renderKey) return { ...item, equipped };
    if (equipped && cleared.has(item.slot)) return { ...item, equipped: false };
    return item;
  });
  patchSnapshot(queryClient, { stateVersion, inventory });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'something went wrong — try again';
}

function rollBack(controls: CosmeticsControls, previous: Wardrobe, onChange: () => void): void {
  applyWardrobe(controls, previous);
  saveWardrobe(previous);
  onChange();
}

/**
 * Wear one owned product: scene first (clearing its body-region siblings, the
 * same exclusivity the server enforces), then the equip mutation. `onChange`
 * fires after every scene change — apply and rollback — so the calling sheet
 * can refresh its worn badges + the head avatar.
 */
export function wearProduct(
  queryClient: QueryClient,
  controls: CosmeticsControls,
  product: Product,
  onChange: () => void,
): void {
  const previous = controls.getState();
  for (const sibling of regionSiblings(product.slot)) {
    if (previous[sibling].equipped) controls.remove(sibling);
  }
  if (product.variantId) controls.equipVariant(product.slot, product.variantId);
  else if (product.color) controls.setColor(product.slot, product.color);
  onChange();
  equipCosmetic(product.renderKey)
    .then(({ stateVersion }) => patchEquippedFlags(queryClient, stateVersion, product, true))
    .catch((error: unknown) => {
      rollBack(controls, previous, onChange);
      Alert.alert("Couldn't equip that", errorMessage(error));
    });
}

/** Take one worn product off: scene first, then the unequip mutation. */
export function takeOffProduct(
  queryClient: QueryClient,
  controls: CosmeticsControls,
  product: Product,
  onChange: () => void,
): void {
  const previous = controls.getState();
  controls.remove(product.slot);
  onChange();
  unequipCosmetic(product.renderKey)
    .then(({ stateVersion }) => patchEquippedFlags(queryClient, stateVersion, product, false))
    .catch((error: unknown) => {
      rollBack(controls, previous, onChange);
      Alert.alert("Couldn't take that off", errorMessage(error));
    });
}
