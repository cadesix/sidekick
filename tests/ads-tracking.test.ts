import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, adEvents, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { type SponsoredAd, registerDevice, serveAd } from "@sidekick/server";
import { createConversation, makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const SAMPLE_AD: SponsoredAd = {
  id: "grav-track",
  brandName: "Brand",
  title: "A thing",
  adText: "buy it",
  cta: "Shop",
  clickUrl: "https://x.example",
  impUrl: "https://imp.example",
};

async function servedAd(deviceId: string): Promise<{ userId: string; adUnitId: string }> {
  const { userId } = await registerDevice(db, { deviceId });
  const conversationId = await createConversation(db, userId);
  const served = await serveAd(db, {
    userId,
    conversationId,
    turnMessageId: 0,
    network: "gravity",
    ad: SAMPLE_AD,
    placement: "below_response",
  });
  return { userId, adUnitId: served.adUnitId };
}

test("impression and click endpoints write ad_events and echo the network urls", async () => {
  const { userId, adUnitId } = await servedAd("track-1");
  const caller = makeCaller(db, textModel("hi"), userId);

  const imp = await caller.ads.impression({ adUnitId });
  expect(imp).toEqual({ ok: true, impressionUrl: "https://imp.example", clickUrl: "https://x.example" });
  await caller.ads.click({ adUnitId });
  await caller.ads.dismiss({ adUnitId });

  const events = await db.select().from(adEvents).where(eq(adEvents.adId, adUnitId));
  const types = events.map((e) => e.type).sort();
  expect(types).toEqual(["click", "dismiss", "impression"]);
});

test("a user cannot log events against another user's ad", async () => {
  const { adUnitId } = await servedAd("track-owner");
  const { userId: intruder } = await registerDevice(db, { deviceId: "track-intruder" });
  const caller = makeCaller(db, textModel("hi"), intruder);

  const result = await caller.ads.impression({ adUnitId });
  expect(result.ok).toBe(false);
  const events = await db
    .select()
    .from(adEvents)
    .where(and(eq(adEvents.adId, adUnitId), eq(adEvents.userId, intruder)));
  expect(events).toHaveLength(0);
});
