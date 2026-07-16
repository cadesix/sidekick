import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, attachments, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import type { ModelMessage } from "ai";
import { buildContextView, dispatchTool, allTools } from "@sidekick/shared";
import { registerDevice } from "@sidekick/server";
import { createConversation } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const STORAGE_URL = (key: string) => `https://cdn.test/${key}`;

async function addMessage(conversationId: string, role: string, content: string): Promise<number> {
  const inserted = await db
    .insert(messages)
    .values({ conversationId, role, content, tokenEstimate: 1 })
    .returning({ id: messages.id });
  const id = inserted[0]?.id;
  if (!id) {
    throw new Error("insert failed");
  }
  return id;
}

async function addAttachment(
  userId: string,
  messageId: number,
  fields: Partial<typeof attachments.$inferInsert> & { kind: string; mime: string; storageKey: string },
): Promise<string> {
  const inserted = await db
    .insert(attachments)
    .values({
      userId,
      messageId,
      bytes: 1024,
      status: "ready",
      ...fields,
    })
    .returning({ id: attachments.id });
  const id = inserted[0]?.id;
  if (!id) {
    throw new Error("attachment insert failed");
  }
  return id;
}

function userMessages(view: { messages: ModelMessage[] }): ModelMessage[] {
  return view.messages.filter((m) => m.role === "user");
}

test("only the 3 most-recent images render as image parts; older ones become [photo: caption]", async () => {
  const { userId } = await registerDevice(db, { deviceId: "view-img" });
  await db.update(users).set({ name: "Maya" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);

  for (let i = 0; i < 4; i++) {
    const messageId = await addMessage(conversationId, "user", "");
    await addAttachment(userId, messageId, {
      kind: "image",
      mime: "image/jpeg",
      storageKey: `k/img-${i}.jpg`,
      caption: `caption ${i}`,
    });
  }

  const view = await buildContextView(db, conversationId, { storageUrl: STORAGE_URL });
  const msgs = userMessages(view);
  expect(msgs).toHaveLength(4);
  // Oldest image aged out of the 3-image window → text placeholder.
  expect(msgs[0]?.content).toBe("[photo: caption 0]");
  // The 3 most recent are real image parts.
  for (const message of msgs.slice(1)) {
    const parts = message.content;
    expect(Array.isArray(parts)).toBe(true);
    const part = Array.isArray(parts) ? parts[0] : undefined;
    expect(part?.type).toBe("image");
  }
});

test("a voice note's transcript is the content, prefixed [voice note]", async () => {
  const { userId } = await registerDevice(db, { deviceId: "view-voice" });
  await db.update(users).set({ name: "Maya" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const messageId = await addMessage(conversationId, "user", "");
  await addAttachment(userId, messageId, {
    kind: "audio",
    mime: "audio/m4a",
    storageKey: "k/voice.m4a",
    transcript: "see you saturday",
    durationMs: 4000,
  });

  const view = await buildContextView(db, conversationId, { storageUrl: STORAGE_URL });
  expect(userMessages(view)[0]?.content).toBe("[voice note] see you saturday");
});

test("a file shows full extracted text while recent, then ages out to [file: name — caption]", async () => {
  const { userId } = await registerDevice(db, { deviceId: "view-file" });
  await db.update(users).set({ name: "Maya" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const fileMessageId = await addMessage(conversationId, "user", "here's the lease");
  await addAttachment(userId, fileMessageId, {
    kind: "file",
    mime: "text/plain",
    storageKey: "k/lease.txt",
    extractedText: "parking spot 12 is included",
    caption: "a lease agreement",
  });

  const recent = await buildContextView(db, conversationId, { storageUrl: STORAGE_URL });
  const recentParts = recent.messages[0]?.content;
  expect(Array.isArray(recentParts)).toBe(true);
  const fencedRecent = Array.isArray(recentParts)
    ? recentParts.find((p) => p.type === "text" && p.text.includes("parking spot 12"))
    : undefined;
  expect(fencedRecent).toBeTruthy();

  // Push the file message > 10 messages back so it ages out of the fulltext window.
  for (let i = 0; i < 12; i++) {
    await addMessage(conversationId, i % 2 === 0 ? "assistant" : "user", `filler ${i}`);
  }

  const aged = await buildContextView(db, conversationId, { storageUrl: STORAGE_URL });
  const agedFileMessage = aged.messages.find(
    (m) => m.role === "user" && typeof m.content !== "string" && Array.isArray(m.content)
      ? m.content.some((p) => p.type === "text" && p.text.startsWith("[file:"))
      : m.content === "here's the lease",
  );
  // The file message now renders as a [file: …] placeholder rather than fenced text.
  const flattened = JSON.stringify(aged.messages);
  expect(flattened).toContain("[file: lease.txt — a lease agreement]");
  expect(flattened).not.toContain("parking spot 12 is included");
  expect(agedFileMessage).toBeTruthy();
});

test("read_attachment returns the full text of a ready attachment and errors on a pending one", async () => {
  const { userId } = await registerDevice(db, { deviceId: "view-read" });
  const conversationId = await createConversation(db, userId);
  const messageId = await addMessage(conversationId, "user", "doc");
  const readyId = await addAttachment(userId, messageId, {
    kind: "file",
    mime: "text/plain",
    storageKey: "k/doc.txt",
    extractedText: "the whole lease text",
    caption: "a lease",
  });
  const pendingId = await addAttachment(userId, messageId, {
    kind: "file",
    mime: "text/plain",
    storageKey: "k/pending.txt",
    status: "processing",
  });

  const tool = allTools.find((t) => t.name === "read_attachment");
  if (!tool) {
    throw new Error("read_attachment not registered");
  }
  const ctx = { db, userId, conversationId };

  const ready = await dispatchTool(tool, { attachment_id: readyId }, ctx);
  expect(ready).toEqual({
    status: "done",
    result: { ok: true, kind: "file", caption: "a lease", content: "the whole lease text" },
  });

  const pending = await dispatchTool(tool, { attachment_id: pendingId }, ctx);
  expect(pending).toEqual({ status: "done", result: { ok: false, error: "attachment is processing" } });
});
