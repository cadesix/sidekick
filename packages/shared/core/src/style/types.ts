// Texting-style controller types. The CONFIG (which traits, their rates) is the
// unit you iterate on — versioned in configs.ts so a tweak is a new version, not
// a destructive edit. The ENGINE (decide.ts + transforms.ts) is stable code that
// reads a config. Keeping them apart is what makes iteration safe: you change a
// config, golden tests pin the old ones, and prod points at whichever id you pick.

/** Traits the controller can turn on for a turn. */
export type TraitId = "elongation" | "abbrev" | "multisend" | "bangspace" | "typo" | "correction";

/**
 * How a trait is applied:
 * - "directive": the MODEL applies it — its `directive` snippet is injected into
 *   the system prompt, but only on turns the trait is enabled (so the model isn't
 *   left to self-calibrate frequency across a static list).
 * - "transform": CODE applies it deterministically to the model's output after
 *   generation (split into bubbles, inject a typo, etc.) — no model compliance
 *   needed, so it's reliable.
 */
export type TraitKind = "directive" | "transform";

export interface TraitSpec {
  id: TraitId;
  kind: TraitKind;
  /** Probability the trait fires on an eligible turn (0..1). */
  baseRate: number;
  /** Turns to suppress the trait after it fires (0 = no cooldown). */
  cooldown: number;
  /** Prompt snippet, injected only when a directive-kind trait fires this turn. */
  directive?: string;
  /** Trait that must have fired first for this one to be eligible (e.g. correction ← typo). */
  requires?: TraitId;
}

export interface StyleConfig {
  /** Version id — prod points at one of these; changing = a new id, never overwrite. */
  id: string;
  description?: string;
  /** At most this many traits fire in a single turn (never stack into a caricature). */
  maxTraitsPerTurn: number;
  traits: TraitSpec[];
}

/** Per-conversation history the controller needs to enforce cooldowns. Persisted by the caller. */
export interface StyleState {
  /** Monotonic turn counter for this conversation. */
  turnIndex: number;
  /** traitId → the turnIndex it last fired on (for cooldown math). */
  lastFired: Partial<Record<TraitId, number>>;
}

export interface StyleDecision {
  /** Every trait enabled this turn (directive + transform). */
  fired: TraitId[];
  /** Prompt snippets for the directive-kind traits that fired — inject these this turn. */
  directives: string[];
  /** Transform-kind traits that fired — apply these to the output after generation. */
  transforms: TraitId[];
}
