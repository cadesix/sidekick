import { expect, test } from "vitest";
import {
  COSMETIC_CATALOG,
  ITEM_CHANCE,
  type Rng,
  WEARABLE_SLOTS,
  getCosmetic,
  grantableCosmetics,
  isStreakMilestone,
  rarityWeights,
  rollReward,
  starterCosmetics,
} from "@sidekick/shared";

/** A scripted random source: replays the given values, then repeats them. */
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

test("catalog is well-formed: unique keys, valid slots/rarities, starter + grantable pools exist", () => {
  const keys = COSMETIC_CATALOG.map((c) => c.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(COSMETIC_CATALOG.length).toBeGreaterThanOrEqual(30);

  for (const item of COSMETIC_CATALOG) {
    expect(["head", "face", "outfit", "accessory", "environment"]).toContain(item.slot);
    expect(["common", "rare", "epic", "legendary"]).toContain(item.rarity);
    expect(item.glyph.length).toBeGreaterThan(0);
  }
  expect(starterCosmetics().length).toBeGreaterThan(0);
  for (const s of starterCosmetics()) {
    expect(WEARABLE_SLOTS).toContain(s.slot);
  }
  expect(grantableCosmetics().length).toBeGreaterThan(0);
  expect(getCosmetic("crown")?.rarity).toBe("legendary");
  expect(getCosmetic("nope")).toBeUndefined();
});

test("front-loaded milestone days match the 04 reward curve, then go weekly", () => {
  for (const day of [1, 2, 3, 5, 7, 10, 14, 21, 28]) {
    expect(isStreakMilestone(day)).toBe(true);
  }
  for (const day of [0, 4, 6, 8, 9, 11, 15, 20, 22]) {
    expect(isStreakMilestone(day)).toBe(false);
  }
});

test("rarity odds shift from common toward the top tiers as the streak grows", () => {
  const low = rarityWeights(0);
  const high = rarityWeights(30);
  expect(high.common).toBeLessThan(low.common);
  expect(high.legendary).toBeGreaterThan(low.legendary);
  expect(high.epic).toBeGreaterThan(low.epic);
});

test("a milestone spin always yields an item, even when the roll would favor sparks", () => {
  // First rng (0.99) would pick sparks on a non-milestone day; the milestone guarantee overrides.
  const out = rollReward({ streak: 7, ownedKeys: [], rng: seq([0.99, 0, 0]) });
  expect(out.kind).toBe("item");
  expect(ITEM_CHANCE).toBeGreaterThan(0);
});

test("a non-milestone low roll grants sparks in the configured range", () => {
  const out = rollReward({ streak: 4, ownedKeys: [], rng: seq([0.9, 0]) });
  expect(out.kind).toBe("sparks");
  if (out.kind === "sparks") {
    expect(out.amount).toBeGreaterThanOrEqual(10);
    expect(out.amount).toBeLessThanOrEqual(25);
  }
});

test("owning the whole grantable pool degrades a guaranteed roll to sparks (pity timer)", () => {
  const everything = grantableCosmetics().map((c) => c.key);
  const out = rollReward({ streak: 14, ownedKeys: everything, rng: seq([0.1, 0.1, 0.1]) });
  expect(out.kind).toBe("sparks");
});

test("rollReward never grants an item the user already owns", () => {
  const grantable = grantableCosmetics();
  const owned = grantable.slice(0, grantable.length - 1).map((c) => c.key);
  const out = rollReward({ streak: 7, ownedKeys: owned, rng: seq([0.5, 0.5, 0.5]) });
  expect(out.kind).toBe("item");
  if (out.kind === "item") {
    expect(owned).not.toContain(out.itemKey);
  }
});
