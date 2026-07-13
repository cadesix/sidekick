import { describe, expect, it } from "vitest";
import {
  type AdView,
  type ChatMessage,
  activeComposerAd,
  buildChatRows,
} from "../packages/expo/src/lib/chat-thread";
import {
  GRAVITY_PIXEL_CONFIG,
  GRAVITY_PIXEL_ID,
  GRAVITY_PIXEL_LOADER,
} from "../packages/expo/src/lib/gravity-pixel";

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

  it("pins the newest ad above the composer and removes it from transcript rows", () => {
    const rows = buildChatRows([adMessage(2), userMessage(1)], now);
    const messageRows = rows.filter((r) => r.type === "message");
    expect(messageRows).toHaveLength(1);
    expect(activeComposerAd([adMessage(2), userMessage(1)])).toEqual(AD);
  });

  it("expires the composer ad as soon as a newer message exists", () => {
    expect(activeComposerAd([userMessage(3), adMessage(2), userMessage(1)])).toBeUndefined();
  });

  it("non-ad messages carry a null ad", () => {
    const rows = buildChatRows([userMessage(1)], now);
    const row = rows.find((r) => r.type === "message");
    if (row?.type === "message") {
      expect(row.message.ad ?? null).toBeNull();
    }
  });
});

describe("Gravity in-app browser pixel", () => {
  it("configures the dashboard pixel for in-app attribution", () => {
    expect(GRAVITY_PIXEL_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(GRAVITY_PIXEL_CONFIG).toContain("inAppBrowser: true");
    expect(GRAVITY_PIXEL_CONFIG).toContain(GRAVITY_PIXEL_ID);
    expect(GRAVITY_PIXEL_LOADER).toContain("https://code.trygravity.ai/gr-pix.js");
    expect(GRAVITY_PIXEL_LOADER).toContain(`gravity('init', '${GRAVITY_PIXEL_ID}')`);
  });
});
