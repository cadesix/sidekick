import { router } from "expo-router";
import {
  focusMirrorPatch,
  focusSetBudgetInput,
  focusUnblockInput,
} from "@sidekick/shared";
import { fetchMe, getFocusSettings } from "~/lib/api";
import {
  disableFocus,
  focusAvailable,
  focusBlocked,
  forceBlock,
  mirrorFocus,
  startDailyMonitor,
  temporaryUnlock,
  todayFocusFlags,
} from "~/lib/focus";

/**
 * The six focus device-tools (13-focus-mode.md §chat tools), run on-device when the
 * model calls one mid-chat. Each executes the native op, mirrors the app-identity-
 * free state to the server, and returns a small JSON result the model reads in-voice.
 * `null` means "not a focus tool" so the dispatcher falls through; `device_unavailable`
 * means focus isn't set up on this device and the model should say so gently.
 */

const DEVICE_UNAVAILABLE = { error: "device_unavailable" } as const;

const FOCUS_TOOL_NAMES = new Set([
  "focus_open_setup",
  "focus_set_budget",
  "focus_block_now",
  "focus_unblock",
  "focus_status",
  "focus_disable",
]);

export function isFocusTool(toolName: string): boolean {
  return FOCUS_TOOL_NAMES.has(toolName);
}

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
    await mirrorFocus(focusMirrorPatch.setBudget(parsed.data.minutes));
    return { ok: true, budgetMinutes: parsed.data.minutes };
  }

  if (toolName === "focus_block_now") {
    forceBlock();
    await mirrorFocus(focusMirrorPatch.blockNow());
    return { ok: true, blocked: true };
  }

  if (toolName === "focus_unblock") {
    const parsed = focusUnblockInput.safeParse(input);
    if (!parsed.success) {
      return DEVICE_UNAVAILABLE;
    }
    const minutes = await temporaryUnlock(parsed.data.minutes);
    return { ok: true, minutes };
  }

  if (toolName === "focus_status") {
    const settings = await getFocusSettings();
    const flags = todayFocusFlags();
    return {
      enabled: settings.enabled,
      budgetMinutes: settings.budgetMinutes,
      appsGuarded: settings.selectionCount,
      warned: flags.warn,
      blocked: flags.limit || focusBlocked(),
    };
  }

  if (toolName === "focus_disable") {
    disableFocus();
    await mirrorFocus(focusMirrorPatch.disable());
    return { ok: true, enabled: false };
  }

  return null;
}
