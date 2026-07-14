import { router } from "expo-router";
import {
  focusSetBudgetInput,
  focusStartSessionInput,
  focusUnblockInput,
} from "@sidekick/shared";
import { fetchMe } from "~/lib/api";
import {
  disableFocus,
  focusAvailable,
  forceBlock,
  patchLocalFocusSettings,
  startDailyMonitor,
  startFocusSession,
  temporaryUnlock,
} from "~/lib/focus";

/**
 * Focus commands run entirely on-device and return only the requested command's
 * success. No Screen Time state or usage is sent back to the model.
 * `null` means "not a focus tool" so the dispatcher falls through; `device_unavailable`
 * means focus isn't set up on this device and the model should say so gently.
 */

/** The shape a device tool returns when it can't run (12 — model handles it in-voice). */
export const DEVICE_UNAVAILABLE = { error: "device_unavailable" } as const;

export async function runFocusDeviceTool(
  toolName: string,
  input: unknown,
): Promise<unknown | null> {
  if (toolName === "focus_open_setup") {
    router.push("/focus-setup");
    return { ok: true, opened: "setup" };
  }

  if (!focusAvailable()) {
    return DEVICE_UNAVAILABLE;
  }

  if (toolName === "focus_set_budget") {
    const parsed = focusSetBudgetInput.safeParse(input);
    if (!parsed.success) {
      return DEVICE_UNAVAILABLE;
    }
    const me = await fetchMe();
    const started = await startDailyMonitor({
      budgetMinutes: parsed.data.minutes,
      sidekickName: me.sidekickName ?? "your sidekick",
    });
    if (!started) {
      return { error: "no_selection" };
    }
    patchLocalFocusSettings({
      enabled: true,
      mode: "daily",
      budgetMinutes: parsed.data.minutes,
      sessionEndsAt: null,
    });
    return { ok: true };
  }

  if (toolName === "focus_block_now") {
    if (!forceBlock()) {
      return { error: "no_selection" };
    }
    return { ok: true };
  }

  if (toolName === "focus_start_session") {
    const parsed = focusStartSessionInput.safeParse(input);
    if (!parsed.success) {
      return DEVICE_UNAVAILABLE;
    }
    const started = await startFocusSession(parsed.data.minutes);
    if (!started) {
      return { error: "no_selection" };
    }
    return { ok: true };
  }

  if (toolName === "focus_unblock") {
    const parsed = focusUnblockInput.safeParse(input);
    if (!parsed.success) {
      return DEVICE_UNAVAILABLE;
    }
    const minutes = await temporaryUnlock(parsed.data.minutes);
    if (minutes === null) {
      return { error: "no_selection" };
    }
    return { ok: true, minutes };
  }

  if (toolName === "focus_disable") {
    disableFocus();
    return { ok: true };
  }

  return null;
}
