import { z } from "zod";

/**
 * The three attachment kinds a message can carry (09). Free text everywhere else
 * in the schema, but the upload path validates against this closed set.
 */
export const attachmentKindSchema = z.enum(["image", "audio", "file"]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

/** Ingest lifecycle (09 §ingest pipeline). */
export const attachmentStatusSchema = z.enum(["uploading", "processing", "ready", "failed"]);
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;

const MB = 1_024 * 1_024;

/**
 * Server-enforced upload limits (09 §data model & storage). Bytes and, for audio,
 * duration. `maxPerMessage` is enforced when the message is sent (batch check).
 */
export const ATTACHMENT_LIMITS = {
  image: { maxBytes: 10 * MB, maxPerMessage: 4 },
  audio: { maxBytes: 25 * MB, maxPerMessage: 1, maxDurationMs: 5 * 60 * 1_000 },
  file: { maxBytes: 20 * MB, maxPerMessage: 1 },
} as const;

/** LLM-view windowing (09 §what the LLM sees). */
export const RECENT_IMAGE_LIMIT = 3;
export const FILE_FULLTEXT_WINDOW_MESSAGES = 10;
export const EXTRACTED_TEXT_CAP = 50_000;
export const PDF_DOCUMENT_MAX_PAGES = 100;
export const PDF_DOCUMENT_MAX_BYTES = 32 * MB;

/** "20mb" from a byte cap — for the in-voice, lowercase over-limit lines. */
export function formatMbLimit(maxBytes: number): string {
  return `${Math.round(maxBytes / MB)}mb`;
}

/**
 * Whether a PDF may ride up as a native Anthropic document block (09 §files):
 * `application/pdf`, ≤32MB, and ≤100 pages. Over any bound it falls back to the
 * extracted-text path. `pages` is null until ingest parses it (older rows / a
 * parse that yielded no count) — treated as within-bound so the byte cap still
 * governs, matching pre-page-gate behavior.
 */
export function pdfNativeEligible(input: {
  mime: string;
  bytes: number;
  pages: number | null;
}): boolean {
  if (input.mime !== "application/pdf") {
    return false;
  }
  if (input.bytes > PDF_DOCUMENT_MAX_BYTES) {
    return false;
  }
  return input.pages === null || input.pages <= PDF_DOCUMENT_MAX_PAGES;
}

export type LimitCheck = { ok: true } | { ok: false; message: string };

/**
 * One attachment against its per-kind byte/duration cap. Messages are lowercase
 * and in the sidekick's voice per 09 (the composer renders them as a caption-sized
 * error line, not a toast).
 */
export function checkUploadLimit(input: {
  kind: AttachmentKind;
  bytes: number;
  durationMs?: number;
}): LimitCheck {
  const limits = ATTACHMENT_LIMITS[input.kind];
  if (input.bytes > limits.maxBytes) {
    const noun = input.kind === "image" ? "image" : input.kind === "audio" ? "voice note" : "file";
    return { ok: false, message: `that ${noun}'s too big (max ${formatMbLimit(limits.maxBytes)})` };
  }
  if (input.kind === "audio" && input.durationMs !== undefined) {
    const maxMs = ATTACHMENT_LIMITS.audio.maxDurationMs;
    if (input.durationMs > maxMs) {
      return { ok: false, message: `that voice note's too long (max ${maxMs / 60_000} min)` };
    }
  }
  return { ok: true };
}

/**
 * A whole message's attachment set against the per-kind `maxPerMessage` caps
 * (09: images max 4, audio 1, file 1). Enforced at send time.
 */
export function checkAttachmentBatch(kinds: AttachmentKind[]): LimitCheck {
  const counts = { image: 0, audio: 0, file: 0 } satisfies Record<AttachmentKind, number>;
  for (const kind of kinds) {
    counts[kind] += 1;
  }
  for (const kind of attachmentKindSchema.options) {
    const max = ATTACHMENT_LIMITS[kind].maxPerMessage;
    if (counts[kind] > max) {
      const noun = kind === "image" ? "photos" : kind === "audio" ? "voice notes" : "files";
      return { ok: false, message: `that's too many ${noun} (max ${max} per message)` };
    }
  }
  return { ok: true };
}
