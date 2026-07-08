import { z } from "zod";

/** Long-term memory categories (user-memory.md §1), mirrored from the DB enum. */
export const memoryKindSchema = z.enum([
  "identity",
  "work_school",
  "relationship",
  "schedule",
  "interest",
  "preference",
  "event",
  "emotional",
  "goal_context",
]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

/**
 * How live a purchase intent is (user-memory.md §5). `active` = the user is
 * shopping now ("my running shoes are dead"); `passive` = a softer,
 * further-out signal. Drives the projection's intent strength + which turns get
 * priority ad slots.
 */
export const intentStrengthSchema = z.enum(["active", "passive"]);
export type IntentStrength = z.infer<typeof intentStrengthSchema>;

/**
 * One `apply_memory_ops` operation (user-memory.md §2). `add`/`supersede` carry a
 * new sentence; `supersede`/`reinforce`/`expire` target an existing memory id;
 * `intent` records a purchase-intent signal (a short noun phrase in `content`,
 * e.g. "running shoes") with a `strength`, written to `purchase_intents` with a
 * TTL rather than to the memory table. The server-side apply enforces the per-op
 * requirements — the schema stays permissive so a scripted or real model's output
 * parses, and invalid combos are skipped rather than throwing.
 */
export const memoryOpSchema = z.object({
  op: z.enum(["add", "supersede", "reinforce", "expire", "intent"]),
  memory_id: z.string().optional(),
  kind: memoryKindSchema.optional(),
  content: z.string().optional(),
  event_date: z.string().optional(),
  confidence: z.enum(["stated", "inferred"]).optional(),
  strength: intentStrengthSchema.optional(),
});
export type MemoryOp = z.infer<typeof memoryOpSchema>;

/** Purchase-intent lifetime (user-memory.md §5): stale intent lapses in ~45 days. */
export const PURCHASE_INTENT_TTL_DAYS = 45;

export const memoryOpsSchema = z.object({
  ops: z.array(memoryOpSchema),
});
export type MemoryOps = z.infer<typeof memoryOpsSchema>;

/**
 * Kinds that may flow into the ad-targeting projection (user-memory.md §5). The
 * allowlist is deliberately tiny: only `interest`. Every sensitive kind
 * (emotional, relationship, identity, work, schedule, preference, goal_context,
 * event) is excluded wholesale, and device health data is excluded at the table
 * level in the projector.
 */
export const AD_PROJECTION_KINDS: readonly MemoryKind[] = ["interest"];
