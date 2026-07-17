import type { StyleConfig } from "./types";

// Versioned style configs. THIS is the file you iterate on. To try something new:
// copy the latest config to a new id ("v2"), tweak its rates/traits, point
// DEFAULT_STYLE_CONFIG_ID (or the lab) at it, and compare. The old versions stay
// intact and golden-tested, so you can always roll back by flipping the id — no
// prompt or processor you liked ever gets clobbered.

const V1: StyleConfig = {
  id: "v1",
  description: "first controller config — moderate multi-send, light quirks",
  maxTraitsPerTurn: 2,
  traits: [
      // multi-send is code-applied (splitIntoBubbles), so it's reliable. High rate
      // + no cooldown = most multi-sentence replies split into a burst (a single
      // sentence never splits, so this stays natural).
      { id: "multisend", kind: "transform", baseRate: 0.85, cooldown: 0 },
      // the model writes these — only prompted on turns they're enabled.
      {
        id: "elongation",
        kind: "directive",
        baseRate: 0.25,
        cooldown: 2,
        directive: "you may stretch the last letter of ONE emphatic word (sooo, yesss, noo).",
      },
      {
        id: "abbrev",
        kind: "directive",
        baseRate: 0.4,
        cooldown: 0,
        directive: "casual texting abbreviations are fine when they fit: lmk, jk, hbu, wyd, rn, ofc, wdym.",
      },
      // code-applied quirks — rare, with real cooldowns so they never cluster.
      { id: "bangspace", kind: "transform", baseRate: 0.15, cooldown: 3 },
      { id: "typo", kind: "transform", baseRate: 0.07, cooldown: 5 },
  ],
};

/** All named config versions. Add new ones here; never overwrite an old one. */
export const STYLE_CONFIGS: Record<string, StyleConfig> = { v1: V1 };
export const DEFAULT_STYLE_CONFIG_ID = "v1";

/** Resolve a config id to its config, falling back to the default. */
export function getStyleConfig(id: string = DEFAULT_STYLE_CONFIG_ID): StyleConfig {
  return STYLE_CONFIGS[id] ?? V1;
}
