import { afterAll, beforeAll, expect, test } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { type Database, attachments, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { registerDevice } from "@sidekick/server";
import { createConversation, makeCaller, textModel, testStorage } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function reserveAttachment(
  caller: ReturnType<typeof makeCaller>,
  kind: "image" | "file",
): Promise<string> {
  const created = await caller.chat.createUploadUrl({
    kind,
    mime: kind === "image" ? "image/jpeg" : "text/plain",
    bytes: 512,
    filename: kind === "image" ? "pic.jpg" : "doc.txt",
  });
  return created.attachmentId;
}

test("a ready attachment sends and links to the user message", async () => {
  const { userId } = await registerDevice(db, { deviceId: "turn-ready" });
  const conversationId = await createConversation(db, userId);
  const caller = makeCaller(db, textModel("got the file"), userId, { storage: testStorage() });

  const attachmentId = await reserveAttachment(caller, "file");
  await db
    .update(attachments)
    .set({ status: "ready", extractedText: "the notes", caption: "some notes" })
    .where(eq(attachments.id, attachmentId));

  const outcome = await caller.chat.send({ conversationId, text: "", attachmentIds: [attachmentId] });
  expect(outcome.message.role).toBe("assistant");
  expect(outcome.message.content).toBe("got the file");

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
  const userRow = rows.find((r) => r.role === "user");
  const linked = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId)))
    .limit(1);
  expect(linked[0]?.messageId).toBe(userRow?.id);
});

test("a failed attachment aborts the turn — no assistant reply is produced", async () => {
  const { userId } = await registerDevice(db, { deviceId: "turn-failed" });
  const conversationId = await createConversation(db, userId);
  const caller = makeCaller(db, textModel("should not happen"), userId, { storage: testStorage() });

  const attachmentId = await reserveAttachment(caller, "file");
  await db.update(attachments).set({ status: "failed" }).where(eq(attachments.id, attachmentId));

  await expect(
    caller.chat.send({ conversationId, text: "read this", attachmentIds: [attachmentId] }),
  ).rejects.toThrow();

  const assistantRows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "assistant")));
  expect(assistantRows).toHaveLength(0);
});

test("the turn waits for a processing attachment to become ready before replying", async () => {
  const { userId } = await registerDevice(db, { deviceId: "turn-wait" });
  const conversationId = await createConversation(db, userId);
  const caller = makeCaller(db, textModel("got it"), userId, { storage: testStorage() });

  const attachmentId = await reserveAttachment(caller, "file");
  await db.update(attachments).set({ status: "processing" }).where(eq(attachments.id, attachmentId));

  // Ingest finishes shortly after the send begins; the turn's poll picks it up.
  const flip = new Promise<void>((resolve) => {
    setTimeout(() => {
      void db
        .update(attachments)
        .set({ status: "ready", extractedText: "the report", caption: "a report" })
        .where(eq(attachments.id, attachmentId))
        .then(() => resolve());
    }, 50);
  });

  const [outcome] = await Promise.all([
    caller.chat.send({ conversationId, text: "here", attachmentIds: [attachmentId] }),
    flip,
  ]);
  expect(outcome.message.content).toBe("got it");
});
