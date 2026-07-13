import {
  type LanguageModel,
  type TranscriptionModel,
  experimental_transcribe as transcribe,
  generateText,
} from "ai";
import { eq } from "drizzle-orm";
import { type Database, attachments } from "@sidekick/db";
import { EXTRACTED_TEXT_CAP } from "@sidekick/shared";
import type { Storage } from "../storage";
import { parseFile } from "./parse";

/** Everything the ingest pipeline needs (09 §ingest). Injected per environment. */
export type IngestServices = {
  db: Database;
  storage: Storage;
  /** Cheap vision/text model for image captions and file summaries. */
  captionModel: LanguageModel;
  /** Audio transcription model (env-gated OpenAI in prod, scripted in tests). */
  transcriptionModel?: TranscriptionModel;
};

/** Longest slice of extracted text we hand the summarizer (keeps ingest cheap). */
const SUMMARY_INPUT_CHARS = 12_000;

async function setStatus(
  db: Database,
  attachmentId: string,
  fields: Partial<typeof attachments.$inferInsert>,
): Promise<void> {
  await db.update(attachments).set(fields).where(eq(attachments.id, attachmentId));
}

async function captionImage(model: LanguageModel, data: Uint8Array, mime: string): Promise<string> {
  const { text } = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "In one short caption of a few words, describe this image (e.g. \"a golden retriever puppy on a beach\"). No preamble, no punctuation at the end.",
          },
          { type: "image", image: data, mediaType: mime },
        ],
      },
    ],
  });
  return text.trim();
}

async function summarizeFile(model: LanguageModel, filename: string, extractedText: string): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: `Summarize this document in about 200 tokens — what it is and its key points. No preamble.\n\nFilename: ${filename}\n\n${extractedText.slice(0, SUMMARY_INPUT_CHARS)}`,
  });
  return text.trim();
}

/** The original filename encoded in the storage key's last segment. */
function filenameFromKey(storageKey: string): string {
  const segment = storageKey.split("/").pop() ?? storageKey;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Run one attachment through its ingest path (09 §ingest pipeline). Drives the
 * status machine uploading/processing → ready | failed:
 * - image → cheap vision caption;
 * - audio → `experimental_transcribe` transcript;
 * - file  → parsed text (capped 50k) + a ~200-token summary caption.
 * Any failure lands the row in `failed` (the bubble shows a retry state and the
 * chat turn refuses to send until it's resolved). Safe to re-run for retry.
 */
export async function ingestAttachment(
  services: IngestServices,
  attachmentId: string,
): Promise<void> {
  const { db, storage, captionModel, transcriptionModel } = services;
  const rows = await db
    .select({
      kind: attachments.kind,
      mime: attachments.mime,
      storageKey: attachments.storageKey,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  const attachment = rows[0];
  if (!attachment) {
    return;
  }

  await setStatus(db, attachmentId, { status: "processing" });

  try {
    if (attachment.kind === "image") {
      const bytes = await storage.getObject(attachment.storageKey);
      const caption = await captionImage(captionModel, bytes, attachment.mime);
      await setStatus(db, attachmentId, { caption, status: "ready" });
      return;
    }

    if (attachment.kind === "audio") {
      if (!transcriptionModel) {
        throw new Error("no transcription model configured");
      }
      const audio = await storage.getObject(attachment.storageKey);
      const { text } = await transcribe({ model: transcriptionModel, audio });
      await setStatus(db, attachmentId, { transcript: text.trim(), status: "ready" });
      return;
    }

    const data = await storage.getObject(attachment.storageKey);
    const filename = filenameFromKey(attachment.storageKey);
    const parsed = await parseFile({ mime: attachment.mime, filename, data });
    const extractedText = parsed.text.slice(0, EXTRACTED_TEXT_CAP + 128);
    const caption =
      extractedText.length > 0
        ? await summarizeFile(captionModel, filename, extractedText)
        : null;
    await setStatus(db, attachmentId, {
      extractedText,
      caption,
      pages: parsed.pageCount,
      status: "ready",
    });
  } catch (error) {
    await setStatus(db, attachmentId, { status: "failed" });
    throw error;
  }
}
