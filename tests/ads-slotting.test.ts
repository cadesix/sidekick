import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { type Database, ads, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  ScriptedAdClient,
  type SponsoredAd,
  markMessagesSensitive,
  registerDevice,
  runAdDecision,
} from "@sidekick/server";
import { createConversation } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const SAMPLE_AD: SponsoredAd = {
  id: "grav-123",
  brandName: "Brooks",
  favicon: "https://cdn.example/brooks.png",
  title: "Meet the Ghost 16",
  adText: "Cushioned daily trainers, free returns.",
  cta: "Shop now",
  clickUrl: "https://brooks.example/ghost16",
  impUrl: "https://gravity.example/imp/123",
};

async function eligibleUser(deviceId: string): Promise<string> {
  const { userId } = await registerDevice(db, { deviceId });
  await db
    .update(users)
    .set({ ageBracket: "25-34", personalizedAdsConsent: true, timezone: "America/New_York" })
    .where(eq(users.id, userId));
  return userId;
}

async function seedTurn(conversationId: string, count: number): Promise<number> {
  let lastId = 0;
  for (let i = 0; i < count; i += 1) {
    const role = i % 2 === 0 ? "user" : "assistant";
    const inserted = await db
      .insert(messages)
      .values({ conversationId, role, content: `msg ${i}`, tokenEstimate: 2 })
      .returning({ id: messages.id });
    lastId = inserted[0]?.id ?? lastId;
  }
  return lastId;
}

test("eligible turn serves an ad: ad message row + ads row, excluded from the LLM view", async () => {
  const userId = await eligibleUser("slot-serve");
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedTurn(conversationId, 3);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision(
    { db, network, flags: {} },
    { userId, conversationId, turnMessageId },
  );

  expect(result.status).toBe("served");
  expect(network.requests).toHaveLength(1);

  const adRows = await db.select().from(ads).where(eq(ads.userId, userId));
  expect(adRows).toHaveLength(1);
  expect(adRows[0]?.brandName).toBe("Brooks");
  expect(adRows[0]?.externalId).toBe("grav-123");

  const adMessages = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNotNull(messages.adUnitId)));
  expect(adMessages).toHaveLength(1);
  expect(adMessages[0]?.adUnitId).toBe(adRows[0]?.id);
});

test("no-fill leaves no ad row and never blocks", async () => {
  const userId = await eligibleUser("slot-nofill");
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedTurn(conversationId, 3);

  const network = new ScriptedAdClient([null]);
  const result = await runAdDecision(
    { db, network, flags: {} },
    { userId, conversationId, turnMessageId },
  );

  expect(result).toEqual({ status: "skipped", reason: "no_fill" });
  expect(network.requests).toHaveLength(1);
  const adRows = await db.select().from(ads).where(eq(ads.userId, userId));
  expect(adRows).toHaveLength(0);
});

test("a null network (no Gravity key) is a silent no-op — never touches the network", async () => {
  const userId = await eligibleUser("slot-disabled");
  const conversationId = await createConversation(db, userId);
  const turnMessageId = await seedTurn(conversationId, 3);

  const result = await runAdDecision(
    { db, network: null, flags: {} },
    { userId, conversationId, turnMessageId },
  );
  expect(result).toEqual({ status: "skipped", reason: "disabled" });
});

test("forwarded context is the stripped window: sensitive rows never reach the network", async () => {
  const userId = await eligibleUser("slot-strip");
  const conversationId = await createConversation(db, userId);

  const health = await db
    .insert(messages)
    .values({
      conversationId,
      role: "assistant",
      content: "you slept 4h12m and your resting hr was elevated",
      tokenEstimate: 8,
    })
    .returning({ id: messages.id });
  await markMessagesSensitive(db, [health[0]!.id]);
  // Nine clean messages after the sensitive one keep it out of the recent
  // suppression window (8) but inside the forward window (12) — so it must be
  // present-but-stripped, not merely out of range.
  const turnMessageId = await seedTurn(conversationId, 9);

  const network = new ScriptedAdClient([SAMPLE_AD]);
  const result = await runAdDecision(
    { db, network, flags: {} },
    { userId, conversationId, turnMessageId },
  );

  expect(result.status).toBe("served");
  const forwarded = network.requests[0]?.messages ?? [];
  expect(forwarded.length).toBeGreaterThan(0);
  for (const message of forwarded) {
    expect(message.content).not.toContain("4h12m");
    expect(message.content).not.toContain("resting hr");
  }
});
