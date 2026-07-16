import { expect, test } from "vitest";
import {
  GOAL_CATALOG,
  addDays,
  cadenceSchema,
  currentStreak,
  defaultActionItem,
  getActionItemTemplate,
  getGoalDefinition,
  localDate,
  localHour,
  weekStart,
} from "@sidekick/shared";

test("every catalog goal is well-formed: 3-6 action items, valid cadences, unique slugs", () => {
  expect(GOAL_CATALOG.length).toBeGreaterThan(0);
  for (const goal of GOAL_CATALOG) {
    expect(goal.actionItems.length).toBeGreaterThanOrEqual(3);
    expect(goal.actionItems.length).toBeLessThanOrEqual(6);
    expect([1, 2, 3]).toContain(goal.tier);

    const slugs = goal.actionItems.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const item of goal.actionItems) {
      expect(() => cadenceSchema.parse(item.defaultCadence)).not.toThrow();
      expect(item.cadenceOptions.length).toBeGreaterThan(0);
      for (const option of item.cadenceOptions) {
        expect(() => cadenceSchema.parse(option)).not.toThrow();
      }
    }
    expect(defaultActionItem(goal.slug)).toEqual(goal.actionItems[0]);
  }
});

test("tier-3 goals offer a weekly micro-challenge", () => {
  const fuzzy = GOAL_CATALOG.filter((g) => g.tier === 3);
  expect(fuzzy.length).toBeGreaterThan(0);
  for (const goal of fuzzy) {
    expect(goal.weeklyChallenge).toBe(true);
  }
});

test("catalog lookups resolve by slug", () => {
  expect(getGoalDefinition("get-fit")?.label).toBe("Get Fit");
  expect(getGoalDefinition("nope")).toBeUndefined();
  expect(getActionItemTemplate("get-fit", "run")?.defaultCadence).toEqual({
    type: "weekly",
    target: 3,
  });
});

test("localDate and localHour use the user's timezone, not the server's", () => {
  const at = new Date("2026-07-06T02:00:00Z");
  expect(localDate("America/New_York", at)).toBe("2026-07-05");
  expect(localDate("UTC", at)).toBe("2026-07-06");

  const noon = new Date("2026-07-06T13:00:00Z");
  expect(localHour("America/New_York", noon)).toBe(9);
  expect(localHour("America/Los_Angeles", noon)).toBe(6);
});

test("addDays / weekStart do pure calendar math across month boundaries", () => {
  expect(addDays("2026-07-06", -1)).toBe("2026-07-05");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  expect(weekStart("2026-07-06")).toBe("2026-06-30");
});

test("currentStreak counts consecutive days ending today or yesterday", () => {
  const today = "2026-07-06";
  expect(currentStreak(["2026-07-06", "2026-07-05", "2026-07-04"], today)).toBe(3);
  expect(currentStreak(["2026-07-05", "2026-07-04"], today)).toBe(2);
  expect(currentStreak(["2026-07-05", "2026-07-03"], today)).toBe(1);
  expect(currentStreak([], today)).toBe(0);
  expect(currentStreak(["2026-07-01"], today)).toBe(0);
});
