import { describe, expect, it } from "vitest";
import {
  type AdView,
  type ChatMessage,
  buildChatRows,
} from "../apps/mobile/lib/chat-thread";

const AD: AdView = {
  adUnitId: "ad-1",
  brandName: "Brooks",
  faviconUrl: "https://cdn.example/brooks.png",
  title: "Meet the Ghost 16",
  body: "Cushioned daily trainers.",
  cta: "Shop now",
  clickUrl: "https://brooks.example",
};

function adMessage(id: number): ChatMessage {
  return {
    id,
    role: "assistant",
    content: AD.title,
    createdAt: new Date(2026, 6, 7, 10, id).toISOString(),
    adUnitId: AD.adUnitId,
    ad: AD,
  };
}

function userMessage(id: number): ChatMessage {
  return {
    id,
    role: "user",
    content: `m${id}`,
    createdAt: new Date(2026, 6, 7, 10, id).toISOString(),
    adUnitId: null,
  };
}

describe("sponsored-card thread rows", () => {
  const now = new Date(2026, 6, 7, 12, 0);

  it("keeps an ad message row (assistant-adjacent) and carries its render payload", () => {
    const rows = buildChatRows([adMessage(2), userMessage(1)], now);
    const messageRows = rows.filter((r) => r.type === "message");
    const adRow = messageRows.find((r) => r.type === "message" && r.message.id === 2);
    expect(adRow?.type).toBe("message");
    if (adRow?.type === "message") {
      expect(adRow.message.ad).toEqual(AD);
      expect(adRow.message.adUnitId).toBe("ad-1");
    }
  });

  it("non-ad messages carry a null ad", () => {
    const rows = buildChatRows([userMessage(1)], now);
    const row = rows.find((r) => r.type === "message");
    if (row?.type === "message") {
      expect(row.message.ad ?? null).toBeNull();
    }
  });
});
