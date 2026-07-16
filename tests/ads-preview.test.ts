import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, ads } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { ScriptedAdClient, type SponsoredAd, registerDevice } from "@sidekick/server";
import { makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const SAMPLE_AD: SponsoredAd = {
  id: "grav-preview",
  brandName: "Brand",
  favicon: "https://brand.example/favicon.ico",
  title: "A thing",
  adText: "buy it",
  cta: "Shop",
  clickUrl: "https://x.example",
  impUrl: "https://imp.example",
};

test("preview returns the network fill as a render payload without persisting it", async () => {
  const { userId } = await registerDevice(db, { deviceId: "preview-1" });
  const network = new ScriptedAdClient([SAMPLE_AD]);
  const caller = makeCaller(db, textModel("hi"), userId, { adNetwork: network });

  const view = await caller.ads.preview();

  expect(view).toEqual({
    adUnitId: "preview",
    brandName: "Brand",
    faviconUrl: "https://brand.example/favicon.ico",
    title: "A thing",
    body: "buy it",
    cta: "Shop",
    clickUrl: "https://x.example",
  });
  expect(network.requests[0]?.messages.length).toBeGreaterThan(0);
  expect(await db.select().from(ads).where(eq(ads.userId, userId))).toHaveLength(0);
});

test("preview is null when ads are disabled or the network has no fill", async () => {
  const { userId } = await registerDevice(db, { deviceId: "preview-2" });

  const disabled = makeCaller(db, textModel("hi"), userId);
  expect(await disabled.ads.preview()).toBeNull();

  const noFill = makeCaller(db, textModel("hi"), userId, {
    adNetwork: new ScriptedAdClient([null]),
  });
  expect(await noFill.ads.preview()).toBeNull();
});
