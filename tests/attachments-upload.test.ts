import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, attachments } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { ATTACHMENT_LIMITS, checkAttachmentBatch, checkUploadLimit } from "@sidekick/shared";
import { registerDevice } from "@sidekick/server";
import { generateModel, makeCaller, testStorage, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("checkUploadLimit enforces per-kind byte + duration caps with in-voice messages", () => {
  expect(checkUploadLimit({ kind: "image", bytes: 5_000_000 })).toEqual({ ok: true });
  const bigImage = checkUploadLimit({ kind: "image", bytes: ATTACHMENT_LIMITS.image.maxBytes + 1 });
  expect(bigImage).toEqual({ ok: false, message: "that image's too big (max 10mb)" });
  const bigFile = checkUploadLimit({ kind: "file", bytes: ATTACHMENT_LIMITS.file.maxBytes + 1 });
  expect(bigFile).toEqual({ ok: false, message: "that file's too big (max 20mb)" });
  const longAudio = checkUploadLimit({ kind: "audio", bytes: 1_000, durationMs: 6 * 60_000 });
  expect(longAudio).toEqual({ ok: false, message: "that voice note's too long (max 5 min)" });
});

test("checkAttachmentBatch enforces per-message counts", () => {
  expect(checkAttachmentBatch(["image", "image", "image", "image"])).toEqual({ ok: true });
  expect(checkAttachmentBatch(["image", "image", "image", "image", "image"])).toEqual({
    ok: false,
    message: "that's too many photos (max 4 per message)",
  });
  expect(checkAttachmentBatch(["file", "file"])).toEqual({
    ok: false,
    message: "that's too many files (max 1 per message)",
  });
});

test("createUploadUrl rejects an over-limit image before reserving a row", async () => {
  const { userId } = await registerDevice(db, { deviceId: "up-limit" });
  const caller = makeCaller(db, textModel("ok"), userId);
  await expect(
    caller.chat.createUploadUrl({
      kind: "image",
      mime: "image/jpeg",
      bytes: ATTACHMENT_LIMITS.image.maxBytes + 1,
    }),
  ).rejects.toThrow(/too big/);
  const rows = await db.select().from(attachments).where(eq(attachments.userId, userId));
  expect(rows).toHaveLength(0);
});

test("createUploadUrl → PUT → attachmentUploaded runs ingest to ready", async () => {
  const { userId } = await registerDevice(db, { deviceId: "up-flow" });
  const storage = testStorage();
  const scheduled: Array<() => Promise<unknown>> = [];
  const caller = makeCaller(db, textModel("ok"), userId, {
    storage,
    captionModel: generateModel("a cozy latte on a windowsill"),
    scheduleBackground: (task) => scheduled.push(task),
  });

  const created = await caller.chat.createUploadUrl({
    kind: "image",
    mime: "image/jpeg",
    bytes: 2048,
    filename: "latte.jpg",
  });
  expect(created.upload.uploadUrl).toContain("/blob/");
  expect(created.storageKey).toContain("latte.jpg");

  // The client PUTs to the target; simulate the write landing in storage.
  await storage.putObject(created.storageKey, new Uint8Array([1, 2, 3]), "image/jpeg");

  await caller.chat.attachmentUploaded({ attachmentId: created.attachmentId });
  const processing = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, created.attachmentId))
    .limit(1);
  expect(processing[0]?.status).toBe("processing");

  expect(scheduled).toHaveLength(1);
  for (const task of scheduled) {
    await task();
  }

  const status = await caller.chat.attachmentStatus({ attachmentIds: [created.attachmentId] });
  expect(status[0]?.status).toBe("ready");
  expect(status[0]?.caption).toBe("a cozy latte on a windowsill");
});

test("retryAttachment re-runs ingest for a failed attachment", async () => {
  const { userId } = await registerDevice(db, { deviceId: "up-retry" });
  const storage = testStorage();
  const scheduled: Array<() => Promise<unknown>> = [];
  const caller = makeCaller(db, textModel("ok"), userId, {
    storage,
    captionModel: generateModel("a sticky note"),
    scheduleBackground: (task) => scheduled.push(task),
  });

  const created = await caller.chat.createUploadUrl({ kind: "image", mime: "image/png", bytes: 512 });
  await db
    .update(attachments)
    .set({ status: "failed" })
    .where(eq(attachments.id, created.attachmentId));
  await storage.putObject(created.storageKey, new Uint8Array([9]), "image/png");

  await caller.chat.retryAttachment({ attachmentId: created.attachmentId });
  for (const task of scheduled) {
    await task();
  }

  const status = await caller.chat.attachmentStatus({ attachmentIds: [created.attachmentId] });
  expect(status[0]?.status).toBe("ready");
});
