// Coin balance + owned-cosmetics inventory — pure tables/clamps. Persistence
// (localStorage on web, AsyncStorage on native) lives in the app adapters; this
// module only owns the numbers and the storage KEYS so both stay identical.

export const COINS_KEY = 'sidekick_coins_v1';
export const INV_KEY = 'sidekick_inventory_v1';

export const START_COINS = 250;
// the outfit you start with is already yours
export const START_INVENTORY = ['shirt-sky'];

export const clampCoins = (v: number): number => Math.max(0, Math.floor(v));

// merge saved inventory with the always-owned starter set
export function ownedSet(saved: string[]): Set<string> {
  return new Set([...START_INVENTORY, ...saved]);
}
