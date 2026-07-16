import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Database, attachments } from "@sidekick/db";
import {
  type AttachmentKind,
  type CreateUploadUrlInput,
  checkUploadLimit,
} from "@sidekick/shared";
import type { Storage, UploadTarget } from "../storage";

const DEFAULT_FILENAME: Record<AttachmentKind, string> = {
  image: "image.jpg",
  audio: "voice.m4a",
  file: "file",
};

export type CreateUploadResult = {
  attachmentId: string;
  storageKey: string;
  upload: UploadTarget;
};

/**
 * Reserve an attachment row and hand back a presigned upload target (09 §storage).
 * Per-kind byte/duration caps are enforced here, before any bytes move; the
 * original filename rides in the storage key (URL-encoded) so the view layer can
 * recover it for `[file: name — …]` without a schema column.
 */
export async function createUpload(
  db: Database,
  storage: Storage,
  userId: string,
  input: CreateUploadUrlInput,
): Promise<CreateUploadResult> {
  const check = checkUploadLimit({
    kind: input.kind,
    bytes: input.bytes,
    durationMs: input.durationMs,
  });
  if (!check.ok) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: check.message });
  }

  const name = encodeURIComponent(input.filename ?? DEFAULT_FILENAME[input.kind]);
  const storageKey = `attachments/${userId}/${randomUUID()}/${name}`;

  const inserted = await db
    .insert(attachments)
    .values({
      userId,
      kind: input.kind,
      mime: input.mime,
      bytes: input.bytes,
      storageKey,
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: input.durationMs ?? null,
      status: "uploading",
    })
    .returning({ id: attachments.id });
  const attachmentId = inserted[0]?.id;
  if (!attachmentId) {
    throw new Error("failed to create attachment");
  }

  const upload = await storage.createUploadTarget({
    storageKey,
    mime: input.mime,
    bytes: input.bytes,
  });
  return { attachmentId, storageKey, upload };
}

async function ownedAttachment(
  db: Database,
  userId: string,
  attachmentId: string,
): Promise<{ storageKey: string } | null> {
  const rows = await db
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Move an attachment to `processing` once the client's PUT lands, gating the
 * ingest run. Returns whether the row exists and belongs to the caller.
 */
export async function markUploaded(
  db: Database,
  userId: string,
  attachmentId: string,
  waveform?: number[],
): Promise<boolean> {
  const owned = await ownedAttachment(db, userId, attachmentId);
  if (!owned) {
    return false;
  }
  await db
    .update(attachments)
    .set({ status: "processing", waveform })
    .where(eq(attachments.id, attachmentId));
  return true;
}

/** Reset a `failed` attachment to `processing` for a retry run. */
export async function markRetrying(
  db: Database,
  userId: string,
  attachmentId: string,
): Promise<boolean> {
  const owned = await ownedAttachment(db, userId, attachmentId);
  if (!owned) {
    return false;
  }
  await db
    .update(attachments)
    .set({ status: "processing" })
    .where(eq(attachments.id, attachmentId));
  return true;
}

export type AttachmentStatusView = {
  id: string;
  kind: string;
  status: string;
  mime: string;
  bytes: number;
  url: string;
  caption: string | null;
  transcript: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
};

export type MessageAttachment = {
  id: string;
  messageId: number;
  kind: string;
  mime: string;
  bytes: number;
  url: string;
  caption: string | null;
  transcript: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
  status: string;
};

/**
 * Attachments for a set of message ids, keyed by messageId, with public URLs —
 * so `chat.history` can render image/voice/file bubbles for past messages (09).
 */
export async function attachmentsForMessages(
  db: Database,
  storage: Storage,
  messageIds: number[],
): Promise<Map<number, MessageAttachment[]>> {
  const grouped = new Map<number, MessageAttachment[]>();
  if (messageIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .select()
    .from(attachments)
    .where(inArray(attachments.messageId, messageIds))
    .orderBy(asc(attachments.createdAt));
  for (const row of rows) {
    if (row.messageId === null) {
      continue;
    }
    const list = grouped.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      messageId: row.messageId,
      kind: row.kind,
      mime: row.mime,
      bytes: row.bytes,
      url: storage.publicUrl(row.storageKey),
      caption: row.caption,
      transcript: row.transcript,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      waveform: row.waveform,
      status: row.status,
    });
    grouped.set(row.messageId, list);
  }
  return grouped;
}

/** The client's poll target: ingest status + everything a bubble needs to render. */
export async function attachmentStatuses(
  db: Database,
  storage: Storage,
  userId: string,
  attachmentIds: string[],
): Promise<AttachmentStatusView[]> {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.userId, userId), inArray(attachments.id, attachmentIds)));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    mime: row.mime,
    bytes: row.bytes,
    url: storage.publicUrl(row.storageKey),
    caption: row.caption,
    transcript: row.transcript,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    waveform: row.waveform,
  }));
}
