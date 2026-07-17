import { hashStr, mulberry32 } from "../rng";
import type { StyleDecision } from "./types";

// Deterministic, code-applied trait transforms. These run on the model's output
// AFTER generation, so they never depend on the model complying — that's what
// makes multi-send (and the mechanical quirks) reliable instead of luck.

/**
 * Split a reply into multiple bubbles by sentence, capped at `maxBubbles`
 * (overflow merges into the last). A single-sentence reply is left as one bubble
 * — you don't break up a single thought. This is what turns one reply into the
 * "person firing off a couple texts" burst.
 */
export function splitIntoBubbles(text: string, maxBubbles = 3): string[] {
  const trimmed = text.trim();
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 2) {
    return [trimmed];
  }
  if (sentences.length <= maxBubbles) {
    return sentences;
  }
  const head = sentences.slice(0, maxBubbles - 1);
  const tail = sentences.slice(maxBubbles - 1).join(" ");
  return [...head, tail];
}

/** Put a space before the first exclamation mark, iMessage-casual ("nice !"). */
export function spaceBeforeBang(text: string): string {
  return text.replace(/(\S)!/, "$1 !");
}

/**
 * Inject one plausible typo — drop an interior letter from a medium-length word,
 * the kind of slip a person leaves in. Deterministic given the rng.
 */
export function injectTypo(text: string, rng: () => number): string {
  const parts = text.split(/(\s+)/); // keep whitespace tokens so we can rejoin exactly
  const candidates: number[] = [];
  parts.forEach((token, i) => {
    if (/^[a-z]{5,}$/i.test(token)) {
      candidates.push(i);
    }
  });
  if (candidates.length === 0) {
    return text;
  }
  const idx = candidates[Math.floor(rng() * candidates.length)];
  const word = parts[idx];
  const pos = 1 + Math.floor(rng() * (word.length - 2)); // interior letter only
  parts[idx] = word.slice(0, pos) + word.slice(pos + 1);
  return parts.join("");
}

/**
 * Apply the transform-kind traits the controller enabled this turn, returning the
 * final list of bubble strings. Text-level quirks run first, then the split.
 * `seed` keeps it reproducible (same reply + decision + seed → same bubbles).
 */
export function applyTransforms(text: string, decision: StyleDecision, seed: string): string[] {
  const rng = mulberry32(hashStr(`${seed}:tx`));
  let out = text.trim();
  if (decision.transforms.includes("typo")) {
    out = injectTypo(out, rng);
  }
  if (decision.transforms.includes("bangspace")) {
    out = spaceBeforeBang(out);
  }
  return decision.transforms.includes("multisend") ? splitIntoBubbles(out) : [out];
}
