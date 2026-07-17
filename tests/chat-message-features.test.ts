import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { createConversation, makeCaller, testStorage, textModel, transcriptionModel, createUser, createUserSession } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function insertMessage(conversationId: string, content: string): Promise<number> {
  const rows = await db
    .insert(messages)
    .values({ conversationId, role: "user", content, tokenEstimate: content.length })
    .returning({ id: messages.id });
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("failed to insert message");
  }
  return id;
}

test("chat.react applies, replaces, and toggles off the caller's reaction", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const messageId = await insertMessage(conversationId, "react to me");
  const caller = makeCaller(db, textModel("ok"), userId);

  await expect(caller.chat.react({ messageId, type: "heart" })).resolves.toEqual([
    { type: "heart", from: "me" },
  ]);
  await expect(caller.chat.react({ messageId, type: "thumbsUp" })).resolves.toEqual([
    { type: "thumbsUp", from: "me" },
  ]);
  await expect(caller.chat.react({ messageId, type: "thumbsUp" })).resolves.toEqual([]);
});

test("chat.react round-trips a custom emoji reaction", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const messageId = await insertMessage(conversationId, "fire");
  const caller = makeCaller(db, textModel("ok"), userId);

  const reactions = await caller.chat.react({ messageId, type: "emoji:🔥" });
  expect(reactions).toEqual([{ type: "emoji:🔥", from: "me" }]);

  const history = await caller.chat.history({ conversationId, limit: 10 });
  expect(history.find((message) => message.id === messageId)?.reactions).toEqual(reactions);
});

test("chat.react and chat.deleteMessage hide another user's message", async () => {
  const owner = await createUserSession(db);
  const stranger = await createUserSession(db);
  const conversationId = await createConversation(db, owner.userId);
  const messageId = await insertMessage(conversationId, "private");
  const caller = makeCaller(db, textModel("ok"), stranger.userId);

  await expect(caller.chat.react({ messageId, type: "heart" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(caller.chat.deleteMessage({ messageId })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });

  const rows = await db.select().from(messages).where(eq(messages.id, messageId));
  expect(rows).toHaveLength(1);
});

test("chat.send persists replyToId and history returns it", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const repliedToId = await insertMessage(conversationId, "original");
  const caller = makeCaller(db, textModel("reply received"), userId);

  await caller.chat.send({ conversationId, text: "a reply", replyToId: repliedToId });

  const history = await caller.chat.history({ conversationId, limit: 10 });
  const reply = history.find((message) => message.role === "user" && message.content === "a reply");
  expect(reply?.replyToId).toBe(repliedToId);
  expect(reply?.reactions).toEqual([]);
});

test("chat.deleteMessage deletes the message and clears replies pointing to it", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const originalId = await insertMessage(conversationId, "original");
  const replyRows = await db
    .insert(messages)
    .values({
      conversationId,
      role: "user",
      content: "reply",
      tokenEstimate: 1,
      replyToId: originalId,
    })
    .returning({ id: messages.id });
  const replyId = replyRows[0]?.id;
  if (replyId === undefined) {
    throw new Error("failed to insert reply");
  }
  const caller = makeCaller(db, textModel("ok"), userId);

  await expect(caller.chat.deleteMessage({ messageId: originalId })).resolves.toEqual({ ok: true });

  const deleted = await db.select().from(messages).where(eq(messages.id, originalId));
  expect(deleted).toHaveLength(0);
  const replies = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, replyId), eq(messages.conversationId, conversationId)));
  expect(replies[0]?.replyToId).toBeNull();
});

test("voice waveform round-trips through upload and chat history", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const storage = testStorage();
  const scheduled: Array<() => Promise<unknown>> = [];
  const caller = makeCaller(db, textModel("heard you"), userId, {
    storage,
    transcriptionModel: transcriptionModel("hello from voice"),
    scheduleBackground: (task) => scheduled.push(task),
  });
  const waveform = [0, 0.15, 0.5, 1, 0.35];

  const created = await caller.chat.createUploadUrl({
    kind: "audio",
    mime: "audio/mp4",
    bytes: 512,
    durationMs: 2_000,
  });
  await storage.putObject(created.storageKey, new Uint8Array([1, 2, 3]), "audio/mp4");
  await caller.chat.attachmentUploaded({ attachmentId: created.attachmentId, waveform });
  const ingest = scheduled.shift();
  if (!ingest) {
    throw new Error("attachment ingest was not scheduled");
  }
  await ingest();

  await caller.chat.send({
    conversationId,
    text: "",
    attachmentIds: [created.attachmentId],
  });

  const history = await caller.chat.history({ conversationId, limit: 10 });
  const voiceMessage = history.find((message) => message.role === "user");
  expect(voiceMessage?.attachments).toHaveLength(1);
  expect(voiceMessage?.attachments[0]?.waveform).toEqual(waveform);
});
