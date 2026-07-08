import { expect, test } from "vitest";
import {
  SHIELD_PRIMARY_LABEL,
  pickShieldSubtitle,
  shieldDayIndex,
  shieldPreview,
  shieldSecondaryLabel,
  shieldTitle,
} from "@sidekick/shared";

test("title and buttons speak in the sidekick's voice", () => {
  expect(shieldTitle("momo")).toBe("hey. it's momo.");
  expect(shieldSecondaryLabel("momo")).toBe("let me ask momo");
  expect(SHIELD_PRIMARY_LABEL).toBe("ok, closing");
});

test("subtitle is deterministic within a day and rotates across days", () => {
  const base = { budgetMinutes: 30, streak: 4, sidekickName: "momo" };
  const morning = pickShieldSubtitle({ ...base, date: new Date(2026, 6, 7, 8, 0) });
  const evening = pickShieldSubtitle({ ...base, date: new Date(2026, 6, 7, 22, 30) });
  expect(morning).toBe(evening);

  // Over a fortnight we should see more than one distinct line (rotation works).
  const seen = new Set<string>();
  for (let day = 0; day < 14; day += 1) {
    seen.add(pickShieldSubtitle({ ...base, date: new Date(2026, 6, 1 + day) }));
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("placeholders are always filled — no braces leak to the shield", () => {
  for (let day = 0; day < 40; day += 1) {
    const withBudget = pickShieldSubtitle({
      date: new Date(2026, 0, 1 + day),
      budgetMinutes: 25,
      streak: 9,
      sidekickName: "momo",
    });
    expect(withBudget).not.toContain("{");
  }
});

test("block-on-demand (no budget) never picks a budget-dependent line", () => {
  for (let day = 0; day < 40; day += 1) {
    const line = pickShieldSubtitle({
      date: new Date(2026, 0, 1 + day),
      budgetMinutes: null,
      streak: 3,
      sidekickName: "momo",
    });
    expect(line).not.toContain("{");
    // budget lines mention "minutes" with the count — none should slip through.
    expect(line).not.toContain(" minutes. i counted");
  }
});

test("streak interpolation lands when a streak line is chosen", () => {
  // Find a day whose eligible line is streak-dependent, then confirm the number shows.
  const streakLineDay = [...Array(30).keys()].find((day) =>
    pickShieldSubtitle({
      date: new Date(2026, 2, 1 + day),
      budgetMinutes: null,
      streak: 12,
      sidekickName: "momo",
    }).includes("12"),
  );
  expect(streakLineDay).toBeDefined();
});

test("day index advances by exactly one per calendar day", () => {
  const a = shieldDayIndex(new Date(2026, 6, 7, 3, 0));
  const b = shieldDayIndex(new Date(2026, 6, 8, 23, 0));
  expect(b - a).toBe(1);
});

test("preview surfaces the exact copy the OS shield will show", () => {
  const preview = shieldPreview({ date: new Date(2026, 6, 7), budgetMinutes: 30, streak: 4, sidekickName: "momo" });
  expect(preview.title).toBe("hey. it's momo.");
  expect(preview.primaryLabel).toBe("ok, closing");
  expect(preview.secondaryLabel).toBe("let me ask momo");
  expect(preview.subtitle).toBe(
    pickShieldSubtitle({ date: new Date(2026, 6, 7), budgetMinutes: 30, streak: 4, sidekickName: "momo" }),
  );
});
