import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, ads, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  ScriptedAdClient,
  type SponsoredAd,
  eligibilityGate,
  hasAdConsent,
  hasFrequencyHeadroom,
  markMessagesSensitive,
  recentWindowIsSensitive,
  runAdDecision,
  serveAd,
} from "@sidekick/server";
import { createConversation, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const SAMPLE_AD: SponsoredAd = {
  id: "grav-1",
  brandName: "Brand",
  title: "A thing",
  adText: "buy it",
  cta: "Shop",
  clickUrl: "https://x.example",
};

async function seedMessages(conversationId: string, count: number, role = "assistant"): Promise<number> {
  let lastId = 0;
  for (let i = 0; i < count; i += 1) {
    const inserted = await db
      .insert(messages)
      .values({ conversationId, role, content: `m${i}`, tokenEstimate: 2 })
      .returning({ id: messages.id });
    lastId = inserted[0]?.id ?? lastId;
  }
  return lastId;
}

test("the pure gate ranks flag → age → consent", () => {
  const eligible = { ageBracket: "25-34", personalizedAdsConsent: true, country: null };
  expect(eligibilityGate(eligible, {})).toBeNull();
  expect(eligibilityGate(eligible, { ads: false })).toBe("flag_off");
  expect(eligibilityGate({ ageBracket: "under-18", personalizedAdsConsent: true, country: "US" }, {})).toBe("minor");
  expect(eligibilityGate({ ageBracket: null, personalizedAdsConsent: true, country: "US" }, {})).toBe("minor");
  expect(eligibilityGate({ ageBracket: "25-34", personalizedAdsConsent: null, country: null }, {})).toBe("no_consent");
  expect(eligibilityGate({ ageBracket: "25-34", personalizedAdsConsent: false, country: "US" }, {})).toBe("no_consent");
});

test("region-aware consent defaults (05: US opt-out, everywhere else opt-in)", () => {
  // Explicit choice always wins, in either direction, in every region.
  expect(hasAdConsent({ personalizedAdsConsent: true, country: "DE" })).toBe(true);
  expect(hasAdConsent({ personalizedAdsConsent: true, country: null })).toBe(true);
  expect(hasAdConsent({ personalizedAdsConsent: false, country: "US" })).toBe(false);
  // No recorded choice: US defaults to consented (opt-out model)…
  expect(hasAdConsent({ personalizedAdsConsent: null, country: "US" })).toBe(true);
  expect(hasAdConsent({ personalizedAdsConsent: null, country: "usa" })).toBe(true);
  expect(hasAdConsent({ personalizedAdsConsent: null, country: "United States" })).toBe(true);
  // …non-US (esp. EEA/UK) and unknown regions require explicit opt-in.
  expect(hasAdConsent({ personalizedAdsConsent: null, country: "DE" })).toBe(false);
  expect(hasAdConsent({ personalizedAdsConsent: null, country: "GB" })).toBe(false);
  expect(hasAdConsent({ personalizedAdsConsent: null, country: null })).toBe(false);

  // Through the gate: US-null passes, DE-null and explicit-false US block.
  expect(eligibilityGate({ ageBracket: "25-34", personalizedAdsConsent: null, country: "US" }, {})).toBeNull();
  expect(eligibilityGate({ ageBracket: "25-34", personalizedAdsConsent: null, country: "DE" }, {})).toBe("no_consent");
  expect(eligibilityGate({ ageBracket: "25-34", personalizedAdsConsent: false, country: "US" }, {})).toBe("no_consent");
  // A US minor with no recorded choice is still a minor — age precedes consent.
  expect(eligibilityGate({ ageBracket: "under-18", personalizedAdsConsent: null, country: "US" }, {})).toBe("minor");
});

test("a US user with no recorded choice gets ads (opt-out default) end to end", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", lastCountry: "US", timezone: "America/New_York" })
    .where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedMessages(conversationId, 2);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision({ db, network, flags: {} }, { userId, conversationId, turnMessageId });

  expect(result.status).toBe("served");
  expect(network.requests).toHaveLength(1);
});

test("a non-US user with no recorded choice never triggers a request", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", lastCountry: "DE" })
    .where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedMessages(conversationId, 2);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision({ db, network, flags: {} }, { userId, conversationId, turnMessageId });

  expect(result).toEqual({ status: "skipped", reason: "no_consent" });
  expect(network.requests).toHaveLength(0);
});

test("a minor NEVER triggers an ad request", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "under-18", personalizedAdsConsent: true })
    .where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedMessages(conversationId, 2);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision({ db, network, flags: {} }, { userId, conversationId, turnMessageId });

  expect(result).toEqual({ status: "skipped", reason: "minor" });
  expect(network.requests).toHaveLength(0);
  expect(await db.select().from(ads).where(eq(ads.userId, userId))).toHaveLength(0);
});

test("no consent → no request", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ ageBracket: "25-34" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedMessages(conversationId, 2);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision({ db, network, flags: {} }, { userId, conversationId, turnMessageId });

  expect(result).toEqual({ status: "skipped", reason: "no_consent" });
  expect(network.requests).toHaveLength(0);
});

test("flag off → no request", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", personalizedAdsConsent: true })
    .where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedMessages(conversationId, 2);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision(
    { db, network, flags: { ads: false } },
    { userId, conversationId, turnMessageId },
  );

  expect(result).toEqual({ status: "skipped", reason: "flag_off" });
  expect(network.requests).toHaveLength(0);
});

test("a sensitive recent moment suppresses the ad before any request", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", personalizedAdsConsent: true })
    .where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedMessages(conversationId, 3);
  const rows = await db
    .insert(messages)
    .values({ conversationId, role: "user", content: "i've felt really low all week", tokenEstimate: 6 })
    .returning({ id: messages.id });
  await markMessagesSensitive(db, [rows[0]!.id]);

  expect(await recentWindowIsSensitive(db, conversationId)).toBe(true);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision({ db, network, flags: {} }, { userId, conversationId, turnMessageId });

  expect(result).toEqual({ status: "skipped", reason: "sensitive_moment" });
  expect(network.requests).toHaveLength(0);
});

test("frequency caps: too soon after the last ad, and the daily ceiling", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", personalizedAdsConsent: true, timezone: "UTC" })
    .where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const now = new Date("2026-07-07T12:00:00.000Z");

  const firstTurn = await seedMessages(conversationId, 2);
  await serveAd(db, {
    userId,
    conversationId,
    turnMessageId: firstTurn,
    network: "gravity",
    ad: SAMPLE_AD,
    placement: "below_response",
  });

  // Only 3 assistant turns since the last ad → under the 6-turn floor.
  const soonTurn = await seedMessages(conversationId, 3);
  expect(
    await hasFrequencyHeadroom(db, { userId, conversationId, turnMessageId: soonTurn, timezone: "UTC", now }),
  ).toBe(false);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision({ db, network, flags: {} }, { userId, conversationId, turnMessageId: soonTurn, now });
  expect(result).toEqual({ status: "skipped", reason: "frequency_cap" });
  expect(network.requests).toHaveLength(0);

  // Past the turn gap, but three ads already today → daily ceiling blocks.
  const farTurn = await seedMessages(conversationId, 8);
  await serveAd(db, { userId, conversationId, turnMessageId: farTurn, network: "gravity", ad: SAMPLE_AD, placement: "below_response" });
  await serveAd(db, { userId, conversationId, turnMessageId: farTurn, network: "gravity", ad: SAMPLE_AD, placement: "below_response" });
  expect(
    await hasFrequencyHeadroom(db, { userId, conversationId, turnMessageId: farTurn, timezone: "UTC", now }),
  ).toBe(false);
});
