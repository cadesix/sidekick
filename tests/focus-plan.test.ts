import { expect, test } from "vitest";
import {
  FOCUS_DAILY_ACTIVITY,
  FOCUS_REBLOCK_ACTIVITY,
  FOCUS_SELECTION_ID,
  FOCUS_SHIELD_ID,
  assertMonitorCapacity,
  budgetLabel,
  clampUnlockMinutes,
  dailyMonitorPlan,
  focusChipState,
  focusMirrorPatch,
  isFocusGoalSlug,
  reblockMonitorPlan,
  selectionCount,
  setupReady,
  warnThresholdMinutes,
} from "@sidekick/shared";

test("warn fires at floor(80% of budget), never below 1 minute", () => {
  expect(warnThresholdMinutes(30)).toBe(24);
  expect(warnThresholdMinutes(45)).toBe(36);
  expect(warnThresholdMinutes(10)).toBe(8);
  expect(warnThresholdMinutes(1)).toBe(1);
});

test("temporary-unlock minutes clamp to the 5–60 window", () => {
  expect(clampUnlockMinutes(3)).toBe(5);
  expect(clampUnlockMinutes(90)).toBe(60);
  expect(clampUnlockMinutes(10)).toBe(10);
  expect(clampUnlockMinutes(10.6)).toBe(11);
  expect(clampUnlockMinutes(5)).toBe(5);
  expect(clampUnlockMinutes(60)).toBe(60);
});

test("daily monitor plan: warn + limit events, native block + midnight unblock", () => {
  const plan = dailyMonitorPlan({ budgetMinutes: 30, selectionToken: "tok", sidekickName: "momo" });
  expect(plan.activityName).toBe(FOCUS_DAILY_ACTIVITY);
  expect(plan.schedule).toEqual({
    intervalStart: { hour: 0, minute: 0 },
    intervalEnd: { hour: 23, minute: 59 },
    repeats: true,
  });

  const [warn, limit] = plan.events;
  expect(warn).toMatchObject({ familyActivitySelection: "tok", threshold: { minute: 24 }, eventName: "warn" });
  expect(limit).toMatchObject({ threshold: { minute: 30 }, eventName: "limit" });

  const limitAction = plan.actions.find((a) => a.eventName === "limit");
  expect(limitAction?.callbackName).toBe("eventDidReachThreshold");
  expect(limitAction?.actions[0]).toEqual({
    type: "blockSelection",
    familyActivitySelectionId: FOCUS_SELECTION_ID,
    shieldId: FOCUS_SHIELD_ID,
  });

  const warnAction = plan.actions.find((a) => a.eventName === "warn");
  const notif = warnAction?.actions[0];
  expect(notif?.type).toBe("sendNotification");
  if (notif?.type === "sendNotification") {
    expect(notif.payload.body).toBe("you're at 80% of your 30 min");
  }

  const midnight = plan.actions.find((a) => a.callbackName === "intervalDidStart");
  expect(midnight?.actions[0]).toEqual({
    type: "unblockSelection",
    familyActivitySelectionId: FOCUS_SELECTION_ID,
  });
});

test("re-block plan: one-off window from now to now+N, blocks on intervalDidEnd", () => {
  const now = new Date(2026, 6, 7, 10, 30, 0);
  const plan = reblockMonitorPlan({ now, minutes: 45 });
  expect(plan.activityName).toBe(FOCUS_REBLOCK_ACTIVITY);
  expect(plan.schedule.repeats).toBe(false);
  expect(plan.schedule.intervalStart).toEqual({ hour: 10, minute: 30 });
  expect(plan.schedule.intervalEnd).toEqual({ hour: 11, minute: 15 });
  expect(plan.events).toEqual([]);

  const end = plan.actions.find((a) => a.callbackName === "intervalDidEnd");
  expect(end?.actions[0]).toEqual({
    type: "blockSelection",
    familyActivitySelectionId: FOCUS_SELECTION_ID,
    shieldId: FOCUS_SHIELD_ID,
  });
});

test("re-block plan clamps its own window", () => {
  const now = new Date(2026, 6, 7, 10, 0, 0);
  const plan = reblockMonitorPlan({ now, minutes: 1000 });
  // clamped to 60 min → ends at 11:00
  expect(plan.schedule.intervalEnd).toEqual({ hour: 11, minute: 0 });
});

test("monitor capacity guard holds the 3-monitor ceiling", () => {
  expect(() => assertMonitorCapacity(["a", "b"], "c")).not.toThrow();
  expect(() => assertMonitorCapacity(["a", "b", "c"], "d")).toThrow();
  // re-registering an already-active monitor doesn't count as a new one
  expect(() => assertMonitorCapacity([FOCUS_DAILY_ACTIVITY, "b", "c"], FOCUS_DAILY_ACTIVITY)).not.toThrow();
});

test("selection count sums apps + categories + web domains", () => {
  expect(selectionCount({ applicationCount: 5, categoryCount: 2, webDomainCount: 0 })).toBe(7);
  expect(selectionCount({ applicationCount: 0, categoryCount: 0, webDomainCount: 0 })).toBe(0);
});

test("home shield chip state", () => {
  expect(focusChipState({ enabled: false, blocked: false })).toBeNull();
  expect(focusChipState({ enabled: true, blocked: false })).toBe("under");
  expect(focusChipState({ enabled: true, blocked: true })).toBe("blocked");
});

test("mirror patches carry only app-identity-free fields", () => {
  expect(focusMirrorPatch.setBudget(30)).toEqual({ enabled: true, budgetMinutes: 30 });
  expect(focusMirrorPatch.blockNow()).toEqual({ enabled: true });
  expect(focusMirrorPatch.disable()).toEqual({ enabled: false });
  expect(focusMirrorPatch.startGuarding({ selectionCount: 7, budgetMinutes: 45 })).toEqual({
    enabled: true,
    selectionCount: 7,
    budgetMinutes: 45,
  });
});

test("setup readiness + labels + focus-goal detection", () => {
  expect(setupReady({ selectionCount: 0 })).toBe(false);
  expect(setupReady({ selectionCount: 1 })).toBe(true);
  expect(budgetLabel(15)).toBe("15m");
  expect(budgetLabel(45)).toBe("45m");
  expect(budgetLabel(60)).toBe("1h");
  expect(isFocusGoalSlug("stop-doomscrolling")).toBe(true);
  expect(isFocusGoalSlug("stop-procrastinating")).toBe(true);
  expect(isFocusGoalSlug("get-fit")).toBe(false);
});
