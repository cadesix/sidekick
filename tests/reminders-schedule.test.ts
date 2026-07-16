import { expect, test } from "vitest";
import {
  type Schedule,
  WEEKDAYS,
  computeNextFireAt,
  rruleWeekdays,
  scheduleKindLabel,
  scheduleTimeLabel,
  weekdaysToRrule,
  zonedWallTimeToUtc,
} from "@sidekick/shared";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

test("zonedWallTimeToUtc resolves a wall clock to the right UTC offset per season", () => {
  const winter = zonedWallTimeToUtc(
    { year: 2026, month: 1, day: 15, hour: 7, minute: 30 },
    NY,
  );
  const summer = zonedWallTimeToUtc(
    { year: 2026, month: 7, day: 15, hour: 7, minute: 30 },
    NY,
  );
  // 07:30 EST (UTC-5) → 12:30Z; 07:30 EDT (UTC-4) → 11:30Z.
  expect(winter.getUTCHours()).toBe(12);
  expect(winter.getUTCMinutes()).toBe(30);
  expect(summer.getUTCHours()).toBe(11);
  expect(summer.getUTCMinutes()).toBe(30);
});

test("once schedule fires at the exact local wall time, timezone-aware", () => {
  const schedule: Schedule = { type: "once", at: "2026-07-10T17:00" };
  const ny = computeNextFireAt(schedule, NY, new Date("2026-07-01T00:00:00Z"));
  const la = computeNextFireAt(schedule, LA, new Date("2026-07-01T00:00:00Z"));
  expect(ny?.toISOString()).toBe("2026-07-10T21:00:00.000Z"); // EDT -4
  expect(la?.toISOString()).toBe("2026-07-11T00:00:00.000Z"); // PDT -7
});

test("once schedule in the past still returns its instant (fires next tick)", () => {
  const schedule: Schedule = { type: "once", at: "2026-01-01T09:00" };
  const fire = computeNextFireAt(schedule, NY, new Date("2026-07-01T00:00:00Z"));
  expect(fire?.toISOString()).toBe("2026-01-01T14:00:00.000Z");
});

test("recurring daily keeps the same wall clock across a DST transition", () => {
  const schedule: Schedule = { type: "recurring", rrule: "FREQ=DAILY", time: "07:30" };
  const beforeDst = computeNextFireAt(schedule, NY, new Date("2026-03-06T20:00:00Z"));
  const afterDst = computeNextFireAt(schedule, NY, new Date("2026-03-08T20:00:00Z"));
  // Both fire at local 07:30, but the UTC instant shifts by the DST hour.
  expect(beforeDst?.toISOString()).toBe("2026-03-07T12:30:00.000Z"); // EST -5
  expect(afterDst?.toISOString()).toBe("2026-03-09T11:30:00.000Z"); // EDT -4
});

test("recurring weekly picks the next matching weekday at the given time", () => {
  const schedule: Schedule = {
    type: "recurring",
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    time: "09:00",
  };
  // 2026-07-07 is a Tuesday, 16:00 EDT; next fire is Wed the 8th at 09:00 EDT.
  const fire = computeNextFireAt(schedule, NY, new Date("2026-07-07T20:00:00Z"));
  expect(fire?.toISOString()).toBe("2026-07-08T13:00:00.000Z");
});

test("recurring fires later today when the time is still ahead, tomorrow once past", () => {
  const schedule: Schedule = { type: "recurring", rrule: "FREQ=DAILY", time: "18:00" };
  const morning = computeNextFireAt(schedule, NY, new Date("2026-07-07T13:00:00Z")); // 09:00 EDT
  const evening = computeNextFireAt(schedule, NY, new Date("2026-07-07T23:00:00Z")); // 19:00 EDT
  expect(morning?.toISOString()).toBe("2026-07-07T22:00:00.000Z"); // today 18:00 EDT
  expect(evening?.toISOString()).toBe("2026-07-08T22:00:00.000Z"); // tomorrow 18:00 EDT
});

test("interval recurrence anchors its phase to createdAt, not to now", () => {
  const schedule: Schedule = { type: "recurring", rrule: "FREQ=DAILY;INTERVAL=3", time: "08:00" };
  const createdAt = new Date("2026-07-01T12:00:00Z"); // local Jul 1
  // Occurrences: Jul 1, 4, 7... After now (Jul 2) the next is Jul 4, not Jul 3.
  const fire = computeNextFireAt(schedule, NY, new Date("2026-07-02T20:00:00Z"), createdAt);
  expect(fire?.toISOString()).toBe("2026-07-04T12:00:00.000Z"); // 08:00 EDT
});

test("an exhausted recurrence returns null", () => {
  const schedule: Schedule = {
    type: "recurring",
    rrule: "FREQ=DAILY;COUNT=1",
    time: "08:00",
  };
  const createdAt = new Date("2026-07-01T12:00:00Z");
  const fire = computeNextFireAt(schedule, NY, new Date("2026-07-05T20:00:00Z"), createdAt);
  expect(fire).toBeNull();
});

test("schedule label + weekday helpers round-trip", () => {
  expect(scheduleTimeLabel({ type: "once", at: "2026-07-10T17:00" })).toBe("5:00 PM");
  expect(scheduleTimeLabel({ type: "recurring", rrule: "FREQ=DAILY", time: "07:05" })).toBe(
    "7:05 AM",
  );
  expect(scheduleKindLabel({ type: "once", at: "2026-07-10T17:00" })).toBe("once");
  expect(
    scheduleKindLabel({ type: "recurring", rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", time: "07:30" }),
  ).toBe("Mon Wed Fri");
  expect(scheduleKindLabel({ type: "recurring", rrule: weekdaysToRrule(WEEKDAYS), time: "07:30" })).toBe(
    "Every day",
  );
  expect(rruleWeekdays("FREQ=WEEKLY;BYDAY=TU,TH")).toEqual(["TU", "TH"]);
  expect(weekdaysToRrule(["FR", "MO"])).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
});
