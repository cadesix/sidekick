import { describe, expect, it } from "vitest";
import {
  type ChatMessage,
  buildChatRows,
  getNextCursor,
  mergeHistoryPages,
  reduceStream,
} from "../packages/expo/src/lib/chat-thread";

function msg(id: number, day: number, role: ChatMessage["role"] = "user"): ChatMessage {
  return {
    id,
    role,
    content: `m${id}`,
    createdAt: new Date(2026, 6, day, 10, id).toISOString(),
    adUnitId: null,
  };
}

describe("buildChatRows", () => {
  const now = new Date(2026, 6, 7, 12, 0);

  it("inserts a day separator above the first message of each local day, newest-first", () => {
    // newest-first input: id3 (day 7), id2 (day 6), id1 (day 6)
    const rows = buildChatRows([msg(3, 7), msg(2, 6), msg(1, 6)], now);
    expect(rows.map((r) => r.type)).toEqual([
      "message", // id3 (today)
      "separator", // Today
      "message", // id2
      "message", // id1
      "separator", // day 6
    ]);
    const separators = rows.filter((r) => r.type === "separator");
    expect(separators[0]).toMatchObject({ label: "Today" });
    expect(separators[1]).toMatchObject({ label: "Yesterday" });
  });

  it("drops tool messages (no user-visible text)", () => {
    const rows = buildChatRows([msg(2, 7, "assistant"), msg(1, 7, "tool")], now);
    const messageRows = rows.filter((r) => r.type === "message");
    expect(messageRows).toHaveLength(1);
  });
});

describe("mergeHistoryPages", () => {
  it("flattens pages newest-first and de-duplicates by id", () => {
    const pageA = [msg(5, 7), msg(4, 7)];
    const pageB = [msg(4, 7), msg(3, 6)];
    const merged = mergeHistoryPages([pageA, pageB]);
    expect(merged.map((m) => m.id)).toEqual([5, 4, 3]);
  });
});

describe("getNextCursor", () => {
  it("returns the oldest id of a full page", () => {
    expect(getNextCursor([msg(5, 7), msg(4, 7)], 2)).toBe(4);
  });

  it("returns undefined when the page is short (no more history)", () => {
    expect(getNextCursor([msg(5, 7)], 2)).toBeUndefined();
  });
});

describe("reduceStream", () => {
  it("concatenates deltas in order", () => {
    expect(reduceStream(["he", "ll", "o"])).toBe("hello");
  });
});
