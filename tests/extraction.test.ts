import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  type Database,
  conversations,
  memories,
  memorySuppressions,
  messages,
  users,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { runExtraction } from "@sidekick/server";
import { createConversation, objectModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function insert(conversationId: string, role: string, content: string): Promise<number> {
  const rows = await db
    .insert(messages)
    .values({ conversationId, role, content, tokenEstimate: content.length })
    .returning({ id: messages.id });
  return rows[0]?.id ?? 0;
}

test("extraction applies add ops, advances the watermark, and bumps memory_version", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  await insert(conversationId, "user", "i got a corgi named biscuit");
  const lastId = await insert(conversationId, "assistant", "aw, biscuit is a great name");

  const model = objectModel({
    ops: [{ op: "add", kind: "relationship", content: "has a corgi named biscuit", confidence: "stated" }],
  });
  const result = await runExtraction(db, model, conversationId);

  expect(result.applied).toBe(1);
  expect(result.advanced).toBe(true);
  expect(result.newWatermark).toBe(lastId);

  const rows = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.content).toBe("has a corgi named biscuit");
  expect(rows[0]?.source).toBe("extraction");

  const conversation = await db
    .select({ watermark: conversations.lastExtractedMessageId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  expect(conversation[0]?.watermark).toBe(lastId);

  const user = await db.select({ v: users.memoryVersion }).from(users).where(eq(users.id, userId));
  expect(user[0]?.v).toBe(2);
});

test("extraction skips an add that matches the suppression list", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  await db.insert(memorySuppressions).values({ userId, content: "likes pineapple pizza" });
  await insert(conversationId, "user", "honestly pineapple pizza is elite");

  const model = objectModel({
    ops: [{ op: "add", kind: "interest", content: "Likes  pineapple pizza", confidence: "stated" }],
  });
  const result = await runExtraction(db, model, conversationId);

  expect(result.applied).toBe(0);
  const rows = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(rows).toHaveLength(0);
});

test("extraction supersedes an existing memory, flipping the old row", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const seeded = await db
    .insert(memories)
    .values({ userId, kind: "work_school", content: "works at acme", source: "onboarding" })
    .returning({ id: memories.id });
  const oldId = seeded[0]?.id ?? "";
  await insert(conversationId, "user", "i just started a new job at globex");

  const model = objectModel({
    ops: [
      { op: "supersede", memory_id: oldId, kind: "work_school", content: "works at globex", confidence: "stated" },
    ],
  });
  const result = await runExtraction(db, model, conversationId);
  expect(result.applied).toBe(1);

  const oldRow = await db.select().from(memories).where(eq(memories.id, oldId));
  expect(oldRow[0]?.status).toBe("superseded");

  const active = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")));
  expect(active).toHaveLength(1);
  expect(active[0]?.content).toBe("works at globex");
  expect(active[0]?.supersedesId).toBe(oldId);
});

test("extraction is a no-op with no new messages", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const model = objectModel({ ops: [] });
  const result = await runExtraction(db, model, conversationId);
  expect(result.advanced).toBe(false);
  expect(result.applied).toBe(0);
});
