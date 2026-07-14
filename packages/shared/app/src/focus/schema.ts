import { z } from "zod";
import { MAX_UNLOCK_MINUTES, MIN_UNLOCK_MINUTES } from "./plan";

/**
 * Focus device-tool and local configuration schemas. Tool inputs cross the wire;
 * the saved configuration stays in the iOS App Group.
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

export const focusStartSessionInput = z.object({
  minutes: z.number().int().min(5).max(180),
});
export type FocusStartSessionInput = z.infer<typeof focusStartSessionInput>;

export const focusModeSchema = z.enum(["daily", "scheduled", "manual"]);
export type FocusMode = z.infer<typeof focusModeSchema>;

export const focusScheduleSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
  label: z.string().max(40),
});
export type FocusScheduleConfig = z.infer<typeof focusScheduleSchema>;

export const localFocusSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: focusModeSchema,
  budgetMinutes: z.number().int().min(1).max(1440).nullable(),
  selectionCount: z.number().int().min(0),
  schedule: focusScheduleSchema.nullable(),
  sessionEndsAt: z.string().nullable(),
});
export type LocalFocusSettings = z.infer<typeof localFocusSettingsSchema>;
