import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type LanguageModel } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { type Database, conversations, memories, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { findIdleConversations, registerDevice, runIdleJob } from "@sidekick/server";
import { createConversation } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

/** One model that answers the extraction `generateObject` call with ops and the
 * compaction `generateText` call with summary prose, keyed on responseFormat. */
function idleModel(ops: unknown[], summary: string): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: async (options) => {
      const isJson = options.responseFormat?.type === "json";
      return {
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        content: [{ type: "text", text: isJson ? JSON.stringify({ ops }) : summary }],
        warnings: [],
      };
    },
  });
}

async function insert(conversationId: string, role: string, content: string, tokens: number): Promise<number> {
  const rows = await db
    .insert(messages)
    .values({ conversationId, role, content, tokenEstimate: tokens })
    .returning({ id: messages.id });
  return rows[0]?.id ?? 0;
}

test("the idle job runs extraction then compaction, holding the ordering invariant", async () => {
  const { userId } = await registerDevice(db, { deviceId: "idle-1" });
  const conversationId = await createConversation(db, userId);

  let lastId = 0;
  for (let i = 0; i < 8; i++) {
    await insert(conversationId, "user", `question ${i}`, 1500);
    lastId = await insert(conversationId, "assistant", `answer ${i}`, 1500);
  }

  const model = idleModel(
    [{ op: "add", kind: "interest", content: "curious about lots of things", confidence: "stated" }],
    "RECENT ARC — you two covered a lot of ground.",
  );
  const result = await runIdleJob(db, model, conversationId);

  expect(result.extraction.advanced).toBe(true);
  expect(result.extraction.newWatermark).toBe(lastId);
  expect(result.compaction).not.toBeNull();

  const conversation = await db
    .select({ watermark: conversations.lastExtractedMessageId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  const watermark = conversation[0]?.watermark ?? 0;
  expect(result.compaction?.coversToMessageId).toBeLessThanOrEqual(watermark);

  const mem = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(mem).toHaveLength(1);
});

test("findIdleConversations returns only conversations idle past the threshold with unseen messages", async () => {
  const now = new Date("2026-07-06T12:00:00Z");

  const idle = await registerDevice(db, { deviceId: "idle-2" });
  const idleConversation = await createConversation(db, idle.userId);
  const idleMessage = await insert(idleConversation, "user", "hello?", 5);
  await db
    .update(messages)
    .set({ createdAt: new Date("2026-07-06T11:00:00Z") })
    .where(eq(messages.id, idleMessage));

  const fresh = await registerDevice(db, { deviceId: "idle-3" });
  const freshConversation = await createConversation(db, fresh.userId);
  await db
    .insert(messages)
    .values({ conversationId: freshConversation, role: "user", content: "hi", tokenEstimate: 2, createdAt: now })
    .returning({ id: messages.id });

  const ids = await findIdleConversations(db, now, { idleMinutes: 30 });
  expect(ids).toContain(idleConversation);
  expect(ids).not.toContain(freshConversation);
});

test("the end-of-day trigger fires exactly once, on the sweep that crosses local midnight", async () => {
  const { userId } = await registerDevice(db, { deviceId: "idle-eod-1" });
  await db.update(users).set({ timezone: "America/Chicago" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const messageId = await insert(conversationId, "user", "night night", 5);
  await db
    .update(messages)
    .set({ createdAt: new Date("2026-07-07T04:50:00Z") })
    .where(eq(messages.id, messageId));

  const sweep = (at: string) =>
    findIdleConversations(db, new Date(at), { idleMinutes: 120, sweepIntervalMinutes: 15 });

  expect(await sweep("2026-07-07T04:55:00Z")).not.toContain(conversationId);
  expect(await sweep("2026-07-07T05:10:00Z")).toContain(conversationId);
  expect(await sweep("2026-07-07T05:25:00Z")).not.toContain(conversationId);
});

test("the end-of-day trigger respects each user's timezone", async () => {
  const chicago = await registerDevice(db, { deviceId: "idle-eod-2" });
  await db.update(users).set({ timezone: "America/Chicago" }).where(eq(users.id, chicago.userId));
  const chicagoConversation = await createConversation(db, chicago.userId);
  const chicagoMessage = await insert(chicagoConversation, "user", "hey", 5);

  const tokyo = await registerDevice(db, { deviceId: "idle-eod-3" });
  await db.update(users).set({ timezone: "Asia/Tokyo" }).where(eq(users.id, tokyo.userId));
  const tokyoConversation = await createConversation(db, tokyo.userId);
  const tokyoMessage = await insert(tokyoConversation, "user", "hey", 5);

  const justSent = new Date("2026-07-07T05:05:00Z");
  await db.update(messages).set({ createdAt: justSent }).where(eq(messages.id, chicagoMessage));
  await db.update(messages).set({ createdAt: justSent }).where(eq(messages.id, tokyoMessage));

  const ids = await findIdleConversations(db, new Date("2026-07-07T05:10:00Z"), {
    idleMinutes: 120,
  });
  expect(ids).toContain(chicagoConversation);
  expect(ids).not.toContain(tokyoConversation);
});

test("the end-of-day trigger skips conversations with nothing new to extract", async () => {
  const { userId } = await registerDevice(db, { deviceId: "idle-eod-4" });
  await db.update(users).set({ timezone: "America/Chicago" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const messageId = await insert(conversationId, "user", "all caught up", 5);
  await db
    .update(messages)
    .set({ createdAt: new Date("2026-07-07T04:50:00Z") })
    .where(eq(messages.id, messageId));
  await db
    .update(conversations)
    .set({ lastExtractedMessageId: messageId })
    .where(eq(conversations.id, conversationId));

  const ids = await findIdleConversations(db, new Date("2026-07-07T05:10:00Z"), {
    idleMinutes: 120,
  });
  expect(ids).not.toContain(conversationId);
});
