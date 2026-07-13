/**
 * Pure, RN-free helpers for the documents surface (15). Kept here so the markdown
 * checkbox toggle and the "edited …" bylines are unit-testable without a device.
 */

/** Matches a GFM task-list line: `- [ ] label` / `* [x] label`, capturing parts. */
const TASK_LINE = /^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/;

/** Strip the `[ ]`/`[x]` marker off a task label, or return null if not a task. */
export function taskLabel(text: string): { checked: boolean; label: string } | null {
  const match = text.match(/^\s*\[( |x|X)\]\s+(.*)$/);
  if (!match) {
    return null;
  }
  return { checked: match[1] !== " ", label: match[2] ?? "" };
}

/**
 * Toggle the first task-list line whose label matches `label`, flipping its
 * `[ ]`↔`[x]` marker. Returns the new markdown (unchanged if no line matches).
 */
export function toggleTaskInMarkdown(content: string, label: string): string {
  let done = false;
  return content
    .split("\n")
    .map((line) => {
      if (done) {
        return line;
      }
      const match = line.match(TASK_LINE);
      if (!match || (match[4] ?? "").trim() !== label.trim()) {
        return line;
      }
      done = true;
      const nextMark = match[2] === " " ? "x" : " ";
      return `${match[1]}[${nextMark}]${match[3]}${match[4]}`;
    })
    .join("\n");
}

/** A coarse "just now / today / yesterday / N days ago / Mon D" relative label. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86400000);
  if (dayDiff <= 0) {
    return "today";
  }
  if (dayDiff === 1) {
    return "yesterday";
  }
  if (dayDiff < 7) {
    return `${dayDiff} days ago`;
  }
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function authorLabel(lastEditedBy: string): string {
  return lastEditedBy === "user" ? "you" : "your sidekick";
}

/** The row byline: "edited yesterday · by your sidekick". */
export function editedByline(updatedAt: string, lastEditedBy: string, now?: Date): string {
  return `edited ${relativeTime(updatedAt, now)} · by ${authorLabel(lastEditedBy)}`;
}
