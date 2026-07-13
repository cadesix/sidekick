import { describe, expect, it } from "vitest";
import { dayLabel, greetingFor, localDayKey, todayLabel } from "../packages/expo/src/lib/date";

describe("greetingFor", () => {
  it("picks the greeting by time of day", () => {
    expect(greetingFor(new Date(2026, 6, 7, 8, 0))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 6, 7, 14, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 6, 7, 20, 0))).toBe("Good evening");
  });
});

describe("todayLabel", () => {
  it("formats weekday, month and day", () => {
    expect(todayLabel(new Date(2026, 6, 7, 9, 0))).toBe("Tuesday, July 7");
  });
});

describe("localDayKey", () => {
  it("is a stable YYYY-MM-DD key in local time", () => {
    expect(localDayKey(new Date(2026, 6, 7, 23, 59))).toBe("2026-07-07");
    expect(localDayKey(new Date(2026, 0, 3, 0, 1))).toBe("2026-01-03");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 6, 7, 12, 0);

  it("uses Today / Yesterday for the two most recent days", () => {
    expect(dayLabel(new Date(2026, 6, 7, 8, 0), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 6, 6, 8, 0), now)).toBe("Yesterday");
  });

  it("uses a short weekday date further back", () => {
    expect(dayLabel(new Date(2026, 5, 29, 8, 0), now)).toBe("Mon, Jun 29");
  });
});
