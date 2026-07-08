import { describe, expect, it } from "vitest";
import {
  authorLabel,
  editedByline,
  relativeTime,
  taskLabel,
  toggleTaskInMarkdown,
} from "../apps/mobile/lib/documents";

describe("taskLabel", () => {
  it("parses checked and unchecked task text", () => {
    expect(taskLabel("[ ] run 3mi")).toEqual({ checked: false, label: "run 3mi" });
    expect(taskLabel("[x] stretch")).toEqual({ checked: true, label: "stretch" });
    expect(taskLabel("just a bullet")).toBeNull();
  });
});

describe("toggleTaskInMarkdown", () => {
  it("flips the first matching task line and leaves others untouched", () => {
    const md = "- [ ] run\n- [ ] swim\n- [x] bike";
    expect(toggleTaskInMarkdown(md, "run")).toBe("- [x] run\n- [ ] swim\n- [x] bike");
    expect(toggleTaskInMarkdown(md, "bike")).toBe("- [ ] run\n- [ ] swim\n- [ ] bike");
  });

  it("returns content unchanged when no label matches", () => {
    const md = "- [ ] run\nplain text";
    expect(toggleTaskInMarkdown(md, "nope")).toBe(md);
  });
});

describe("bylines", () => {
  it("labels authors", () => {
    expect(authorLabel("sidekick")).toBe("your sidekick");
    expect(authorLabel("user")).toBe("you");
  });

  it("formats an edited byline with a relative time", () => {
    const now = new Date("2026-07-07T12:00:00Z");
    const iso = new Date("2026-07-07T11:59:10Z").toISOString();
    expect(relativeTime(iso, now)).toBe("just now");
    expect(editedByline(iso, "sidekick", now)).toBe("edited just now · by your sidekick");
  });
});
