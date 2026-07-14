import { type CosmeticDefinition, type Rarity, RARITIES, grantableCosmetics } from "./catalog";

/**
 * The variable-reward math (04). Pure and deterministic given an injected `rng`,
 * so the server rolls authoritatively and tests assert exact outcomes. Grant
 * *persistence* (idempotency, sparks balance) lives in the server; this file only
 * decides *what* a spin yields.
 */

/** A random source in [0, 1). `Math.random` in production, a scripted fn in tests. */
export type Rng = () => number;

/**
 * Front-loaded guaranteed-item days (04 reward curve): 1, 2, 3, 5, 7, 10, 14,
 * then weekly. The first week feels generous; anticipation carries the rest.
 */
export const BASE_MILESTONES: readonly number[] = [1, 2, 3, 5, 7, 10, 14];

export function isStreakMilestone(streak: number): boolean {
  if (BASE_MILESTONES.includes(streak)) {
    return true;
  }
  return streak > 14 && (streak - 14) % 7 === 0;
}

/** Chance a non-milestone spin yields an item (vs a sparks consolation). */
export const ITEM_CHANCE = 0.65;

/** Sparks a sparks-outcome grants, and the cost to redeem any chosen item. */
export const SPARKS_MIN = 10;
export const SPARKS_MAX = 25;
export const REDEEM_COST = 100;

/**
 * Rarity odds that improve with streak length (04: "rarity odds improve with
 * streak length"). Longer streaks bleed weight out of `common` into the top
 * tiers. Weights are relative; the weighted pick normalizes them.
 */
export function rarityWeights(streak: number): Record<Rarity, number> {
  const s = Math.max(0, streak);
  return {
    common: Math.max(6, 60 - s * 2.5),
    rare: 25 + s,
    epic: 8 + s * 0.75,
    legendary: 4 + s * 0.6,
  };
}

function weightedPick<T>(entries: [T, number][], rng: Rng): T | null {
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total <= 0) {
    return null;
  }
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= Math.max(0, weight);
    if (roll < 0) {
      return value;
    }
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

export type GrantOutcome =
  | { kind: "item"; itemKey: string; rarity: Rarity }
  | { kind: "sparks"; amount: number };

function sparksOutcome(rng: Rng): GrantOutcome {
  const span = SPARKS_MAX - SPARKS_MIN + 1;
  return { kind: "sparks", amount: SPARKS_MIN + Math.floor(rng() * span) };
}

/**
 * Pick an unowned grantable item, biased to `rarity` but degrading gracefully:
 * if that tier is exhausted it falls back to the nearest tiers, so a user only
 * ever hits the sparks fallback once they own literally everything grantable.
 */
function pickItem(rarity: Rarity, ownedKeys: Set<string>, rng: Rng): CosmeticDefinition | null {
  const pool = grantableCosmetics().filter((c) => !ownedKeys.has(c.key));
  if (pool.length === 0) {
    return null;
  }
  const order = [rarity, ...RARITIES.filter((r) => r !== rarity)];
  for (const tier of order) {
    const tierPool = pool.filter((c) => c.rarity === tier);
    if (tierPool.length > 0) {
      const idx = Math.min(tierPool.length - 1, Math.floor(rng() * tierPool.length));
      return tierPool[idx] ?? null;
    }
  }
  return null;
}

/**
 * Roll one spinner reward (04). On a streak milestone an item is guaranteed;
 * otherwise it's a weighted item-or-sparks draw. Dupes never waste a roll — an
 * exhausted rarity degrades to other tiers, and only a fully-collected wardrobe
 * yields the sparks fallback.
 */
export function rollReward(input: {
  streak: number;
  ownedKeys: Iterable<string>;
  rng?: Rng;
}): GrantOutcome {
  const rng = input.rng ?? Math.random;
  const owned = new Set(input.ownedKeys);
  const guaranteed = isStreakMilestone(input.streak);

  if (!guaranteed && rng() >= ITEM_CHANCE) {
    return sparksOutcome(rng);
  }

  const weights = rarityWeights(input.streak);
  const rarity =
    weightedPick(RARITIES.map((r) => [r, weights[r]] as [Rarity, number]), rng) ?? "common";
  const picked = pickItem(rarity, owned, rng);
  if (!picked) {
    return sparksOutcome(rng);
  }
  return { kind: "item", itemKey: picked.key, rarity: picked.rarity };
}
