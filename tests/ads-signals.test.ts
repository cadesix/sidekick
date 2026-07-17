import { afterAll, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { type Database, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  ScriptedAdClient,
  type SponsoredAd,
  deviceSignalsFromHeaders,
  recordAdEvent,
  runAdDecision,
  serveAd,
} from "@sidekick/server";
import { createConversation, makeCaller, textModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const SAMPLE_AD: SponsoredAd = {
  id: "grav-sig",
  brandName: "Brooks",
  title: "Meet the Ghost 16",
  adText: "Cushioned daily trainers.",
  cta: "Shop now",
  clickUrl: "https://brooks.example",
};

function headers(map: Record<string, string>): (name: string) => string | undefined {
  return (name) => map[name.toLowerCase()];
}

async function eligibleUser(deviceId: string): Promise<string> {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({
      ageBracket: "25-34",
      personalizedAdsConsent: true,
      timezone: "UTC",
      email: `${deviceId}@example.com`,
    })
    .where(eq(users.id, userId));
  return userId;
}

async function seedTurn(conversationId: string, count: number): Promise<number> {
  let lastId = 0;
  for (let i = 0; i < count; i += 1) {
    const inserted = await db
      .insert(messages)
      .values({ conversationId, role: "assistant", content: `m${i}`, tokenEstimate: 2 })
      .returning({ id: messages.id });
    lastId = inserted[0]?.id ?? lastId;
  }
  return lastId;
}

test("device signals are parsed from real request headers", () => {
  const signals = deviceSignalsFromHeaders(
    headers({
      "user-agent": "CFNetwork/1498 Darwin/23.5",
      "x-sidekick-user-agent": "Sidekick/1.0 (ios; 19.2)",
      "x-sidekick-device-id": "device-123",
      "x-sidekick-timezone": "America/New_York",
      "accept-language": "en-US,en;q=0.9",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "x-vercel-ip-country": "US",
    }),
  );
  expect(signals).toEqual({
    ua: "Sidekick/1.0 (ios; 19.2)",
    ip: "203.0.113.9",
    os: "ios",
    country: "US",
    id: "device-123",
    timezone: "America/New_York",
    locale: "en-US",
  });

  const android = deviceSignalsFromHeaders(
    headers({ "user-agent": "Sidekick/1.0 (Linux; Android 16)", "x-real-ip": "198.51.100.7" }),
  );
  expect(android).toEqual({
    ua: "Sidekick/1.0 (Linux; Android 16)",
    ip: "198.51.100.7",
    os: "android",
  });

  expect(deviceSignalsFromHeaders(headers({}))).toBeUndefined();
});

test("authenticated identity and device signals are forwarded to Gravity", async () => {
  const userId = await eligibleUser("sig-direct");
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedTurn(conversationId, 2);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const device = { ua: "Sidekick/1.0 (iPhone)", ip: "203.0.113.9", os: "ios", country: "US" };
  const result = await runAdDecision(
    { db, network, flags: {} },
    { userId, conversationId, turnMessageId, device },
  );

  expect(result.status).toBe("served");
  expect(network.requests[0]?.device).toEqual({ ...device, timezone: "UTC" });
  expect(network.requests[0]?.emailHash).toBe(
    createHash("sha256").update("sig-direct@example.com").digest("hex"),
  );
});

test("the tRPC send path threads ctx.device into the ad request", async () => {
  const userId = await eligibleUser("sig-trpc");
  const conversationId = await createConversation(db, userId);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const device = deviceSignalsFromHeaders(
    headers({
      "user-agent": "Sidekick/1.0 (iPhone; iOS 19.2)",
      "x-forwarded-for": "203.0.113.9",
      "x-vercel-ip-country": "US",
    }),
  );
  const tasks: (() => Promise<unknown>)[] = [];
  const caller = makeCaller(db, textModel("hey!"), userId, {
    scheduleBackground: (task) => {
      tasks.push(task);
    },
    adNetwork: network,
    device,
  });

  await caller.chat.send({ conversationId, text: "morning" });
  for (const task of tasks) {
    await task();
  }

  expect(network.requests).toHaveLength(1);
  expect(network.requests[0]?.device).toEqual({
    ua: "Sidekick/1.0 (iPhone; iOS 19.2)",
    ip: "203.0.113.9",
    os: "ios",
    country: "US",
    timezone: "UTC",
  });
});

test("a dismissed ad's topic is excluded from every subsequent request", async () => {
  const userId = await eligibleUser("sig-dismiss");
  const conversationId = await createConversation(db, userId);

  const firstTurn = await seedTurn(conversationId, 2);
  const served = await serveAd(db, {
    userId,
    conversationId,
    turnMessageId: firstTurn,
    network: "gravity",
    ad: SAMPLE_AD,
    placement: "below_response",
  });
  await recordAdEvent(db, { userId, adUnitId: served.adUnitId, type: "dismiss" });

  // Enough assistant turns since the served ad to clear the frequency floor.
  const nextTurn = await seedTurn(conversationId, 8);
  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision(
    { db, network, flags: {} },
    { userId, conversationId, turnMessageId: nextTurn },
  );

  expect(result.status).toBe("served");
  const excluded = network.requests[0]?.excludedTopics ?? [];
  expect(excluded).toContain("brooks");
  // The static sensitive backstop is still present alongside the feedback.
  expect(excluded).toContain("health");
});

test("an impression or click does not become an excluded topic", async () => {
  const userId = await eligibleUser("sig-imp");
  const conversationId = await createConversation(db, userId);

  const firstTurn = await seedTurn(conversationId, 2);
  const served = await serveAd(db, {
    userId,
    conversationId,
    turnMessageId: firstTurn,
    network: "gravity",
    ad: SAMPLE_AD,
    placement: "below_response",
  });
  await recordAdEvent(db, { userId, adUnitId: served.adUnitId, type: "impression" });
  await recordAdEvent(db, { userId, adUnitId: served.adUnitId, type: "click" });

  const nextTurn = await seedTurn(conversationId, 8);
  const network = new ScriptedAdClient([SAMPLE_AD]);
  await runAdDecision({ db, network, flags: {} }, { userId, conversationId, turnMessageId: nextTurn });

  expect(network.requests[0]?.excludedTopics).not.toContain("brooks");
});
