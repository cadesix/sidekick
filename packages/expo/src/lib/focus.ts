import { Platform } from "react-native";
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
  getFamilyActivitySelectionId,
  isAvailable,
  requestAuthorization,
  resetBlocks,
  startMonitoring,
  stopMonitoring,
  unblockSelection,
  updateShieldWithId,
  userDefaultsGet,
  userDefaultsSet,
} from "react-native-device-activity";
import {
  FOCUS_DAILY_ACTIVITY,
  FOCUS_REBLOCK_ACTIVITY,
  FOCUS_SCHEDULE_ACTIVITY_PREFIX,
  FOCUS_SELECTION_ID,
  FOCUS_SESSION_ACTIVITY,
  FOCUS_SHIELD_ID,
  type FocusMode,
  type FocusMonitorPlan,
  type FocusScheduleConfig,
  type LocalFocusSettings,
  SHIELD_KNOCK_BODY,
  SHIELD_KNOCK_TITLE,
  SHIELD_PRIMARY_LABEL,
  assertMonitorCapacity,
  clampUnlockMinutes,
  dailyMonitorPlan,
  focusSessionPlan,
  localFocusSettingsSchema,
  pickShieldSubtitle,
  reblockMonitorPlan,
  scheduledMonitorPlan,
  shieldSecondaryLabel,
  shieldTitle,
} from "@sidekick/shared";
import { fetchHome, fetchMe } from "./api";

const APPROVED = 2;
const LOCAL_SETTINGS_KEY = "sidekickFocusSettings";
const SCHEDULE_ACTIVITY_NAMES = Array.from(
  { length: 7 },
  (_, index) => `${FOCUS_SCHEDULE_ACTIVITY_PREFIX}-${index + 1}`,
);
const ALL_MONITORS = [
  FOCUS_DAILY_ACTIVITY,
  FOCUS_REBLOCK_ACTIVITY,
  FOCUS_SESSION_ACTIVITY,
  ...SCHEDULE_ACTIVITY_NAMES,
];

export const DEFAULT_FOCUS_SCHEDULE: FocusScheduleConfig = {
  days: [2, 3, 4, 5, 6],
  startHour: 9,
  startMinute: 0,
  endHour: 17,
  endMinute: 0,
  label: "Work",
};

export const DEFAULT_FOCUS_SETTINGS: LocalFocusSettings = {
  enabled: false,
  mode: "daily",
  budgetMinutes: 30,
  selectionCount: 0,
  schedule: null,
  sessionEndsAt: null,
};

export function focusAvailable(): boolean {
  return Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 16 && isAvailable();
}

export function focusAuthorizationStatus(): number {
  if (!focusAvailable()) {
    return 0;
  }
  return getAuthorizationStatus();
}

export async function requestFocusAuthorization(): Promise<boolean> {
  if (!focusAvailable()) {
    return false;
  }
  await requestAuthorization("individual");
  return getAuthorizationStatus() === APPROVED;
}

export function focusSelectionToken(): string | undefined {
  return getFamilyActivitySelectionId(FOCUS_SELECTION_ID);
}

export function getLocalFocusSettings(): LocalFocusSettings {
  if (!focusAvailable()) {
    return DEFAULT_FOCUS_SETTINGS;
  }
  const parsed = localFocusSettingsSchema.safeParse(userDefaultsGet<unknown>(LOCAL_SETTINGS_KEY));
  if (!parsed.success) {
    return DEFAULT_FOCUS_SETTINGS;
  }
  return parsed.data;
}

export function saveLocalFocusSettings(settings: LocalFocusSettings): LocalFocusSettings {
  const parsed = localFocusSettingsSchema.parse(settings);
  if (focusAvailable()) {
    userDefaultsSet(LOCAL_SETTINGS_KEY, parsed);
  }
  return parsed;
}

export function patchLocalFocusSettings(
  patch: Partial<LocalFocusSettings>,
): LocalFocusSettings {
  return saveLocalFocusSettings({ ...getLocalFocusSettings(), ...patch });
}

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

export async function startDailyMonitor(input: {
  budgetMinutes: number;
  sidekickName: string;
}): Promise<boolean> {
  if (!focusAvailable()) {
    return false;
  }
  const token = focusSelectionToken();
  if (!token) {
    return false;
  }
  assertMonitorCapacity(getActivities(), FOCUS_DAILY_ACTIVITY);
  await applyMonitorPlan(
    dailyMonitorPlan({
      budgetMinutes: input.budgetMinutes,
      selectionToken: token,
      sidekickName: input.sidekickName,
    }),
  );
  return true;
}

async function startScheduledMonitors(schedule: FocusScheduleConfig): Promise<boolean> {
  if (!focusSelectionToken()) {
    return false;
  }
  for (const weekday of schedule.days) {
    const plan = scheduledMonitorPlan({
      weekday,
      startHour: schedule.startHour,
      startMinute: schedule.startMinute,
      endHour: schedule.endHour,
      endMinute: schedule.endMinute,
    });
    assertMonitorCapacity(getActivities(), plan.activityName);
    await applyMonitorPlan(plan);
  }
  return true;
}

export async function activateFocus(input: {
  mode: FocusMode;
  budgetMinutes: number | null;
  schedule: FocusScheduleConfig | null;
  selectionCount: number;
  sidekickName: string;
}): Promise<boolean> {
  if (!focusAvailable() || !focusSelectionToken() || input.selectionCount < 1) {
    return false;
  }
  stopMonitoring(ALL_MONITORS);
  let started = true;
  if (input.mode === "daily" && input.budgetMinutes !== null) {
    started = await startDailyMonitor({
      budgetMinutes: input.budgetMinutes,
      sidekickName: input.sidekickName,
    });
  } else if (input.mode === "scheduled" && input.schedule !== null) {
    started = await startScheduledMonitors(input.schedule);
  }
  if (!started) {
    return false;
  }
  saveLocalFocusSettings({
    enabled: true,
    mode: input.mode,
    budgetMinutes: input.budgetMinutes,
    selectionCount: input.selectionCount,
    schedule: input.schedule,
    sessionEndsAt: null,
  });
  refreshShield({
    date: new Date(),
    budgetMinutes: input.budgetMinutes,
    streak: 0,
    sidekickName: input.sidekickName,
  });
  return true;
}

export function forceBlock(): boolean {
  if (!focusAvailable() || !focusSelectionToken()) {
    return false;
  }
  blockSelection({ activitySelectionId: FOCUS_SELECTION_ID }, "focus_block_now");
  return true;
}

export async function startFocusSession(minutes: number): Promise<boolean> {
  if (!focusAvailable() || !focusSelectionToken()) {
    return false;
  }
  const now = new Date();
  assertMonitorCapacity(getActivities(), FOCUS_SESSION_ACTIVITY);
  forceBlock();
  await applyMonitorPlan(focusSessionPlan({ now, minutes }));
  patchLocalFocusSettings({
    enabled: true,
    sessionEndsAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
  });
  return true;
}

export function unblock(): void {
  if (focusAvailable()) {
    unblockSelection({ activitySelectionId: FOCUS_SELECTION_ID }, "focus_unblock");
  }
}

export async function temporaryUnlock(minutes: number): Promise<number | null> {
  const applied = clampUnlockMinutes(minutes);
  if (!focusAvailable() || !focusSelectionToken()) {
    return null;
  }
  assertMonitorCapacity(getActivities(), FOCUS_REBLOCK_ACTIVITY);
  unblock();
  await applyMonitorPlan(reblockMonitorPlan({ now: new Date(), minutes: applied }));
  return applied;
}

export function disableFocus(): void {
  if (!focusAvailable()) {
    return;
  }
  stopMonitoring(ALL_MONITORS);
  unblock();
  resetBlocks("focus_disable");
  patchLocalFocusSettings({ enabled: false, sessionEndsAt: null });
}

const WHITE = { red: 255, green: 255, blue: 255 };
const WHITE_60 = { red: 255, green: 255, blue: 255, alpha: 0.6 };
const SUN = { red: 242, green: 201, blue: 76 };
const INK = { red: 17, green: 17, blue: 17 };

export function refreshShield(input: {
  date: Date;
  budgetMinutes: number | null;
  streak: number;
  sidekickName: string;
}): void {
  if (!focusAvailable()) {
    return;
  }
  const config: ShieldConfiguration = {
    title: shieldTitle(input.sidekickName),
    subtitle: pickShieldSubtitle(input),
    titleColor: WHITE,
    subtitleColor: WHITE_60,
    backgroundBlurStyle: UIBlurEffectStyle.systemThickMaterialDark,
    iconSystemName: "shield.lefthalf.filled",
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

export async function maybeRefreshFocusShield(): Promise<void> {
  const settings = getLocalFocusSettings();
  if (!focusAvailable() || !settings.enabled) {
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
