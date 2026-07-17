import { hashStr, mulberry32 } from "../rng";
import type { StyleConfig, StyleDecision, StyleState } from "./types";

// The controller: given a config, the conversation's style history, and a seed,
// deterministically decide which traits fire THIS turn. Frequency lives here, in
// code — not in the prompt where the model would self-calibrate it into either
// "every message" or "never". Pure and seeded, so it's fully reproducible/tested.

/** Fresh state for a new conversation. */
export function initStyleState(): StyleState {
  return { turnIndex: 0, lastFired: {} };
}

/**
 * Decide the enabled traits for this turn. Each trait rolls once (stable RNG
 * sequence), gated by its cooldown, a per-turn budget, and any dependency
 * (`requires`). Directive traits contribute prompt snippets; transform traits are
 * listed for the post-generation pass.
 *
 * `seed` should be stable per (conversation, turn) — e.g. `${conversationId}:${turnIndex}`.
 */
export function decideStyle(config: StyleConfig, state: StyleState, seed: string): StyleDecision {
  const rng = mulberry32(hashStr(seed));
  const fired: StyleDecision["fired"] = [];
  const directives: string[] = [];
  const transforms: StyleDecision["transforms"] = [];
  let budget = config.maxTraitsPerTurn;

  for (const trait of config.traits) {
    const roll = rng(); // always consume one draw so the sequence is state-independent
    if (budget <= 0) {
      continue;
    }
    const last = state.lastFired[trait.id];
    const onCooldown = last !== undefined && state.turnIndex - last <= trait.cooldown;
    if (onCooldown) {
      continue;
    }
    if (trait.requires !== undefined && !fired.includes(trait.requires)) {
      continue; // dependency didn't fire this turn (e.g. correction needs a typo)
    }
    if (roll < trait.baseRate) {
      fired.push(trait.id);
      if (trait.kind === "directive" && trait.directive) {
        directives.push(trait.directive);
      } else if (trait.kind === "transform") {
        transforms.push(trait.id);
      }
      budget -= 1;
    }
  }

  return { fired, directives, transforms };
}

/** Advance state after a turn: record what fired and bump the turn counter. */
export function advanceStyleState(state: StyleState, decision: StyleDecision): StyleState {
  const lastFired = { ...state.lastFired };
  for (const id of decision.fired) {
    lastFired[id] = state.turnIndex;
  }
  return { turnIndex: state.turnIndex + 1, lastFired };
}

/** Render the enabled directive snippets into a compact per-turn prompt block (or "" if none). */
export function renderStyleDirective(decision: StyleDecision): string {
  if (decision.directives.length === 0) {
    return "";
  }
  return `For THIS message only, you may use these, naturally and at most once each:\n${decision.directives
    .map((d) => `- ${d}`)
    .join("\n")}`;
}
