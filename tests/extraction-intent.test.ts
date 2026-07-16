import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, memories, messages, purchaseIntents } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { registerDevice, runExtraction } from "@sidekick/server";
import { createConversation, objectModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("an intent op writes a purchase_intents row with a strength and a TTL, not a memory", async () => {
  const { userId } = await registerDevice(db, { deviceId: "intent-1" });
  const conversationId = await createConversation(db, userId);
  await db
    .insert(messages)
    .values({ conversationId, role: "user", content: "ugh my running shoes are totally dead", tokenEstimate: 8 });

  const now = new Date("2026-07-07T00:00:00.000Z");
  const model = objectModel({
    ops: [{ op: "intent", content: "running shoes", strength: "active" }],
  });
  const result = await runExtraction(db, model, conversationId, { now });
  expect(result.applied).toBe(1);

  const intents = await db.select().from(purchaseIntents).where(eq(purchaseIntents.userId, userId));
  expect(intents).toHaveLength(1);
  expect(intents[0]?.signal).toBe("running shoes");
  expect(intents[0]?.strength).toBe("active");
  expect(intents[0]?.sourceSessionId).toBe(conversationId);
  // 45-day TTL from `now`.
  expect(intents[0]?.expiresAt.getTime()).toBe(now.getTime() + 45 * 24 * 60 * 60 * 1000);

  // Intent is NOT a memory row.
  const mems = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(mems).toHaveLength(0);
});

test("an intent op with no content is skipped", async () => {
  const { userId } = await registerDevice(db, { deviceId: "intent-2" });
  const conversationId = await createConversation(db, userId);
  await db.insert(messages).values({ conversationId, role: "user", content: "hey", tokenEstimate: 2 });

  const model = objectModel({ ops: [{ op: "intent", strength: "passive" }] });
  const result = await runExtraction(db, model, conversationId);
  expect(result.applied).toBe(0);
  expect(await db.select().from(purchaseIntents).where(eq(purchaseIntents.userId, userId))).toHaveLength(0);
});
