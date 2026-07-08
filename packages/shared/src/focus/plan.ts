/**
 * Focus mode (13-focus-mode.md) — the pure, platform-free half of the feature.
 * These builders shape the DeviceActivity monitor schedules, threshold events and
 * shield actions the native module consumes, plus the budget/unlock math. Nothing
 * here imports `react-native-device-activity`; the mobile seam (lib/focus.ts) maps
 * these shapes onto the real module at the call boundary, and vitest exercises them
 * directly. Structural types below are deliberate mirrors of the module's public
 * types (DeviceActivitySchedule / DeviceActivityEvent / Action) so the seam can pass
 * a plan straight through and TypeScript still checks assignability.
 */

/** The single on-device selection id — the apps the user chose to guard (opaque). */
export const FOCUS_SELECTION_ID = "focus";
/** The shield the block actions raise; also the id the module ties config to. */
export const FOCUS_SHIELD_ID = "sidekick";
/** The repeating daily-budget monitor. */
export const FOCUS_DAILY_ACTIVITY = "focus-daily";
/** The one-off monitor that re-blocks when a temporary unlock elapses. */
export const FOCUS_REBLOCK_ACTIVITY = "focus-reblock";

/** Platform allows 20; we use at most 3 (daily, re-block, 03's passive threshold). */
export const MAX_FOCUS_MONITORS = 3;

export const MIN_UNLOCK_MINUTES = 5;
export const MAX_UNLOCK_MINUTES = 60;
/** Warn the user once they've spent this fraction of the daily budget. */
export const WARN_FRACTION = 0.8;

/** Doomscroll/procrastinate goals are the ones focus mode backs (03 Tier 4). */
export const FOCUS_GOAL_SLUGS = ["stop-doomscrolling", "stop-procrastinating"] as const;

export function isFocusGoalSlug(slug: string): boolean {
  return (FOCUS_GOAL_SLUGS as readonly string[]).includes(slug);
}

/** Foundation DateComponents subset — a wall-clock point or an accumulated duration. */
export type FocusDateComponents = { hour?: number; minute?: number; second?: number };

export type FocusSchedule = {
  intervalStart: FocusDateComponents;
  intervalEnd: FocusDateComponents;
  repeats: boolean;
};

export type FocusThresholdEvent = {
  familyActivitySelection: string;
  threshold: FocusDateComponents;
  eventName: string;
};

export type FocusNotificationPayload = {
  title: string;
  body: string;
  userInfo?: Record<string, string>;
};

/** The subset of the module's Action union focus uses. */
export type FocusAction =
  | { type: "blockSelection"; familyActivitySelectionId: string; shieldId?: string }
  | { type: "unblockSelection"; familyActivitySelectionId: string }
  | { type: "sendNotification"; payload: FocusNotificationPayload };

export type FocusCallbackName = "intervalDidStart" | "intervalDidEnd" | "eventDidReachThreshold";

/** One `configureActions` call: fire `actions` when `callbackName`(+`eventName`) hits. */
export type FocusActionConfig = {
  callbackName: FocusCallbackName;
  eventName?: string;
  actions: FocusAction[];
};

/** Everything the seam needs to register one monitor and wire its actions. */
export type FocusMonitorPlan = {
  activityName: string;
  schedule: FocusSchedule;
  events: FocusThresholdEvent[];
  actions: FocusActionConfig[];
};

/** Minute of accumulated use at which the 80% warning fires. At least 1. */
export function warnThresholdMinutes(budgetMinutes: number): number {
  return Math.max(1, Math.floor(budgetMinutes * WARN_FRACTION));
}

/** The temporary-unlock length, clamped to the sanctioned 5–60 min window. */
export function clampUnlockMinutes(minutes: number): number {
  const rounded = Math.round(minutes);
  if (rounded < MIN_UNLOCK_MINUTES) {
    return MIN_UNLOCK_MINUTES;
  }
  if (rounded > MAX_UNLOCK_MINUTES) {
    return MAX_UNLOCK_MINUTES;
  }
  return rounded;
}

/** Total guarded things (apps + categories + web domains) for the "7 apps" mirror. */
export function selectionCount(meta: {
  applicationCount: number;
  categoryCount: number;
  webDomainCount: number;
}): number {
  return meta.applicationCount + meta.categoryCount + meta.webDomainCount;
}

/**
 * The repeating daily-budget monitor (13 §mechanics). Two threshold events on the
 * focus selection — a warn at 80% (local notification) and the limit (native block
 * behind the sidekick shield) — plus a midnight `intervalDidStart` unblock so every
 * day starts fresh. The block fires inside the monitor extension with no JS running.
 */
export function dailyMonitorPlan(input: {
  budgetMinutes: number;
  selectionToken: string;
  sidekickName: string;
}): FocusMonitorPlan {
  const warnAt = warnThresholdMinutes(input.budgetMinutes);
  return {
    activityName: FOCUS_DAILY_ACTIVITY,
    schedule: {
      intervalStart: { hour: 0, minute: 0 },
      intervalEnd: { hour: 23, minute: 59 },
      repeats: true,
    },
    events: [
      {
        familyActivitySelection: input.selectionToken,
        threshold: { minute: warnAt },
        eventName: "warn",
      },
      {
        familyActivitySelection: input.selectionToken,
        threshold: { minute: input.budgetMinutes },
        eventName: "limit",
      },
    ],
    actions: [
      {
        callbackName: "eventDidReachThreshold",
        eventName: "warn",
        actions: [
          {
            type: "sendNotification",
            payload: {
              title: `it's ${input.sidekickName}.`,
              body: `you're at 80% of your ${input.budgetMinutes} min`,
              userInfo: { type: "focus_warn" },
            },
          },
        ],
      },
      {
        callbackName: "eventDidReachThreshold",
        eventName: "limit",
        actions: [
          {
            type: "blockSelection",
            familyActivitySelectionId: FOCUS_SELECTION_ID,
            shieldId: FOCUS_SHIELD_ID,
          },
        ],
      },
      {
        callbackName: "intervalDidStart",
        actions: [{ type: "unblockSelection", familyActivitySelectionId: FOCUS_SELECTION_ID }],
      },
    ],
  };
}

/**
 * The one-off re-block monitor for a temporary unlock (13 §mechanics): an interval
 * from now to now+N whose `intervalDidEnd` action re-raises the shield block —
 * natively, even if the user never returns to our app. `repeats:false`.
 */
export function reblockMonitorPlan(input: { now: Date; minutes: number }): FocusMonitorPlan {
  const clamped = clampUnlockMinutes(input.minutes);
  const end = new Date(input.now.getTime() + clamped * 60_000);
  return {
    activityName: FOCUS_REBLOCK_ACTIVITY,
    schedule: {
      intervalStart: { hour: input.now.getHours(), minute: input.now.getMinutes() },
      intervalEnd: { hour: end.getHours(), minute: end.getMinutes() },
      repeats: false,
    },
    events: [],
    actions: [
      {
        callbackName: "intervalDidEnd",
        actions: [
          {
            type: "blockSelection",
            familyActivitySelectionId: FOCUS_SELECTION_ID,
            shieldId: FOCUS_SHIELD_ID,
          },
        ],
      },
    ],
  };
}

/**
 * Guard the 20-monitor platform ceiling (13 §mechanics) before starting another.
 * Throws rather than silently over-scheduling — the seam surfaces it as a device
 * failure and the model degrades in-voice.
 */
export function assertMonitorCapacity(activeActivityNames: string[], adding: string): void {
  const willBeActive = activeActivityNames.includes(adding)
    ? activeActivityNames.length
    : activeActivityNames.length + 1;
  if (willBeActive > MAX_FOCUS_MONITORS) {
    throw new Error(
      `focus: refusing to exceed ${MAX_FOCUS_MONITORS} concurrent monitors (have ${activeActivityNames.length})`,
    );
  }
}

/** The server mirror never holds app identity — just enough for the sidekick's context. */
export type FocusMirrorPatch = {
  enabled?: boolean;
  budgetMinutes?: number | null;
  selectionCount?: number;
};

export const focusMirrorPatch = {
  /** `focus_set_budget` / setup with a budget: on, and the new daily budget. */
  setBudget(minutes: number): FocusMirrorPatch {
    return { enabled: true, budgetMinutes: minutes };
  },
  /** `focus_block_now`: on (block-on-demand needs no budget). */
  blockNow(): FocusMirrorPatch {
    return { enabled: true };
  },
  /** `focus_disable`: off. Budget/selection are left as-is for a later re-enable. */
  disable(): FocusMirrorPatch {
    return { enabled: false };
  },
  /** "start guarding" on the setup screen: on, with the chosen budget + app count. */
  startGuarding(input: { selectionCount: number; budgetMinutes: number | null }): FocusMirrorPatch {
    return {
      enabled: true,
      selectionCount: input.selectionCount,
      budgetMinutes: input.budgetMinutes,
    };
  },
} as const;

export const BUDGET_CHOICES = [15, 30, 45, 60] as const;

/** "15m" / "30m" / "45m" / "1h" — the budget ReplyChip labels. */
export function budgetLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

/** Setup's "start guarding" is live only once at least one app is chosen (13 §UI). */
export function setupReady(input: { selectionCount: number }): boolean {
  return input.selectionCount > 0;
}

export type FocusChipState = "under" | "blocked" | null;

/** Home goal-row shield chip (13 §home): nothing when off, else under/blocked. */
export function focusChipState(input: { enabled: boolean; blocked: boolean }): FocusChipState {
  if (!input.enabled) {
    return null;
  }
  if (input.blocked) {
    return "blocked";
  }
  return "under";
}
