import {
  type Action,
  type CallbackName,
  type DeviceActivityEvent,
  type DeviceActivitySchedule,
  type ShieldActions,
  type ShieldConfiguration,
  UIBlurEffectStyle,
  blockSelection,
  configureActions,
  getActivities,
  getAuthorizationStatus,
  getEvents,
  getFamilyActivitySelectionId,
  isAvailable,
  isShieldActive,
  requestAuthorization,
  resetBlocks,
  startMonitoring,
  stopMonitoring,
  unblockSelection,
  updateShieldWithId,
} from "react-native-device-activity";
import {
  FOCUS_DAILY_ACTIVITY,
  FOCUS_REBLOCK_ACTIVITY,
  FOCUS_SELECTION_ID,
  FOCUS_SHIELD_ID,
  type FocusMonitorPlan,
  SHIELD_KNOCK_BODY,
  SHIELD_KNOCK_TITLE,
  SHIELD_PRIMARY_LABEL,
  assertMonitorCapacity,
  clampUnlockMinutes,
  dailyMonitorPlan,
  pickShieldSubtitle,
  reblockMonitorPlan,
  shieldSecondaryLabel,
  shieldTitle,
} from "@sidekick/shared";
import { fetchHome, fetchMe, getFocusSettings, updateFocusSettings } from "./api";

/**
 * The single seam onto Apple's Family Controls / DeviceActivity / ManagedSettings
 * (13-focus-mode.md), wrapping `react-native-device-activity`. Every native call
 * lives here, guarded by `isAvailable()` — the entitlement may be missing, or iOS
 * may be < 15.1, in which case each function no-ops or reports unavailable and the
 * self-report tier keeps the goal alive. The shape of every schedule/event/action
 * is built by the pure helpers in `@sidekick/shared`; this file only maps them onto
 * the module and executes. It NEVER learns which apps the user picked — tokens are
 * opaque and stay on-device.
 */

const APPROVED = 2;

export function focusAvailable(): boolean {
  return isAvailable();
}

/** Contextual Family Controls authorization (13 / 03). Resolves to whether granted. */
export async function requestFocusAuthorization(): Promise<boolean> {
  if (!isAvailable()) {
    return false;
  }
  await requestAuthorization();
  return getAuthorizationStatus() === APPROVED;
}

/** The persisted selection token, or undefined if the user hasn't picked apps yet. */
export function focusSelectionToken(): string | undefined {
  return getFamilyActivitySelectionId(FOCUS_SELECTION_ID);
}

/** Register one monitor from a pure plan: its schedule/events plus its actions. */
function applyMonitorPlan(plan: FocusMonitorPlan): Promise<void> {
  for (const config of plan.actions) {
    const actions: Action[] = config.actions;
    const callbackName: CallbackName = config.callbackName;
    configureActions({
      activityName: plan.activityName,
      callbackName,
      eventName: config.eventName,
      actions,
    });
  }
  const schedule: DeviceActivitySchedule = plan.schedule;
  const events: DeviceActivityEvent[] = plan.events;
  return startMonitoring(plan.activityName, schedule, events);
}

/**
 * (Re)configure the repeating daily-budget monitor (13 §mechanics): warn at 80%,
 * block at the limit behind the sidekick shield, unblock at midnight. Requires a
 * persisted selection — returns false if the user hasn't picked apps.
 */
export async function startDailyMonitor(input: {
  budgetMinutes: number;
  sidekickName: string;
}): Promise<boolean> {
  if (!isAvailable()) {
    return false;
  }
  const token = focusSelectionToken();
  if (!token) {
    return false;
  }
  assertMonitorCapacity(getActivities(), FOCUS_DAILY_ACTIVITY);
  await applyMonitorPlan(
    dailyMonitorPlan({ budgetMinutes: input.budgetMinutes, selectionToken: token, sidekickName: input.sidekickName }),
  );
  return true;
}

/** Force block now ("lock me out, i'm studying"). */
export function forceBlock(): void {
  if (!isAvailable()) {
    return;
  }
  blockSelection({ activitySelectionId: FOCUS_SELECTION_ID }, "focus_block_now");
}

/** Lift the block immediately (no re-block scheduled — used by disable). */
export function unblock(): void {
  if (!isAvailable()) {
    return;
  }
  unblockSelection({ activitySelectionId: FOCUS_SELECTION_ID }, "focus_unblock");
}

/**
 * Temporary unlock (13 §mechanics): lift the block now and start a one-off monitor
 * that natively re-blocks when the window elapses — even if the user never reopens
 * the app. Returns the actually-applied minutes (clamped 5–60).
 */
export async function temporaryUnlock(minutes: number): Promise<number> {
  const applied = clampUnlockMinutes(minutes);
  if (!isAvailable()) {
    return applied;
  }
  assertMonitorCapacity(getActivities(), FOCUS_REBLOCK_ACTIVITY);
  unblock();
  await applyMonitorPlan(reblockMonitorPlan({ now: new Date(), minutes: applied }));
  return applied;
}

/** Turn focus fully off (13 §disable): stop every focus monitor and drop all blocks. */
export function disableFocus(): void {
  if (!isAvailable()) {
    return;
  }
  stopMonitoring([FOCUS_DAILY_ACTIVITY, FOCUS_REBLOCK_ACTIVITY]);
  unblock();
  resetBlocks("focus_disable");
}

/** Whether the shield is currently up (drives the home "blocked" chip). */
export function focusBlocked(): boolean {
  if (!isAvailable()) {
    return false;
  }
  return isShieldActive();
}

/** Today's warn/limit flags for `focus_status`, read from the monitor's event log. */
export function todayFocusFlags(): { warn: boolean; limit: boolean } {
  if (!isAvailable()) {
    return { warn: false, limit: false };
  }
  const events = getEvents(FOCUS_DAILY_ACTIVITY);
  return {
    warn: events.some((event) => event.eventName === "warn"),
    limit: events.some((event) => event.eventName === "limit"),
  };
}

const WHITE = { red: 255, green: 255, blue: 255 } as const;
const WHITE_60 = { red: 255, green: 255, blue: 255, alpha: 0.6 } as const;
const SUN = { red: 242, green: 201, blue: 76 } as const;
const INK = { red: 17, green: 17, blue: 17 } as const;

/**
 * Push the shield's static config to the App Group so the ShieldConfiguration
 * extension can render it (13 §shield). Refreshed once daily on foreground — the
 * subtitle rotates by day so the shield never feels canned. Registered under
 * `sidekick` (the id the block actions raise), title/subtitle in the sidekick's
 * voice, systemThickMaterialDark blur, sun primary button, moon.stars.fill icon.
 * Secondary "let me ask {name}" fires a local notification that deep-links to chat.
 */
export function refreshShield(input: {
  date: Date;
  budgetMinutes: number | null;
  streak: number;
  sidekickName: string;
}): void {
  if (!isAvailable()) {
    return;
  }
  const config: ShieldConfiguration = {
    title: shieldTitle(input.sidekickName),
    subtitle: pickShieldSubtitle(input),
    titleColor: WHITE,
    subtitleColor: WHITE_60,
    backgroundBlurStyle: UIBlurEffectStyle.systemThickMaterialDark,
    iconSystemName: "moon.stars.fill",
    iconTint: SUN,
    primaryButtonLabel: SHIELD_PRIMARY_LABEL,
    primaryButtonBackgroundColor: SUN,
    primaryButtonLabelColor: INK,
    secondaryButtonLabel: shieldSecondaryLabel(input.sidekickName),
    secondaryButtonLabelColor: WHITE,
  };
  const actions: ShieldActions = {
    primary: { behavior: "close" },
    secondary: {
      behavior: "close",
      actions: [
        {
          type: "sendNotification",
          payload: {
            title: SHIELD_KNOCK_TITLE,
            body: SHIELD_KNOCK_BODY,
            userInfo: { type: "focus" },
          },
        },
      ],
    },
  };
  updateShieldWithId(config, actions, FOCUS_SHIELD_ID);
}

/**
 * On foreground: if focus is on, refresh the daily shield line. Reads the mirror +
 * profile + streak the shield needs. Silent no-op when focus is unavailable or off.
 * Called from the existing foreground sync in app/_layout.tsx.
 */
export async function maybeRefreshFocusShield(): Promise<void> {
  if (!isAvailable()) {
    return;
  }
  const settings = await getFocusSettings();
  if (!settings.enabled) {
    return;
  }
  const [me, home] = await Promise.all([fetchMe(), fetchHome()]);
  refreshShield({
    date: new Date(),
    budgetMinutes: settings.budgetMinutes,
    streak: home.streak,
    sidekickName: me.sidekickName ?? "your sidekick",
  });
}

/** Mirror the app-identity-free focus state to the server after a native op (13). */
export function mirrorFocus(patch: {
  enabled?: boolean;
  budgetMinutes?: number | null;
  selectionCount?: number;
}): Promise<unknown> {
  return updateFocusSettings(patch);
}
