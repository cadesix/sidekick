import { z } from "zod";
import { MAX_UNLOCK_MINUTES, MIN_UNLOCK_MINUTES } from "./plan";

/**
 * Focus device-tool + mirror schemas (13-focus-mode.md). The tool params are what
 * the model emits; the client validates them before touching the native module.
 * `focusMirrorInput` is the server mirror's partial upsert — only the three
 * app-identity-free fields ever cross the wire.
 */

/** `focus_set_budget(minutes)` — a daily budget in minutes. */
export const focusSetBudgetInput = z.object({
  minutes: z.number().int().min(1).max(1440),
});
export type FocusSetBudgetInput = z.infer<typeof focusSetBudgetInput>;

/**
 * `focus_unblock(minutes)` — a temporary unlock. The model may propose any number;
 * the client clamps to 5–60 (clampUnlockMinutes), but we still bound the input.
 */
export const focusUnblockInput = z.object({
  minutes: z.number().int().min(MIN_UNLOCK_MINUTES).max(MAX_UNLOCK_MINUTES),
});
export type FocusUnblockInput = z.infer<typeof focusUnblockInput>;

/** `focus.update` — the mirror patch the client posts after a native op succeeds. */
export const focusMirrorInput = z.object({
  enabled: z.boolean().optional(),
  budgetMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  selectionCount: z.number().int().min(0).optional(),
});
export type FocusMirrorInput = z.infer<typeof focusMirrorInput>;
