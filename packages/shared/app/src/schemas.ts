import { z } from "zod";
import { attachmentKindSchema } from "./attachments";
import { memoryKindSchema } from "./memory/ops";

export const messageRole = z.enum(["user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof messageRole>;

/** Device registration → anonymous account (01-architecture.md auth). */
export const registerInput = z.object({
  deviceId: z.string().min(8),
  publicKey: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const chatSendInput = z
  .object({
    conversationId: z.string().uuid(),
    text: z.string().default(""),
    attachmentIds: z.array(z.string().uuid()).max(4).optional(),
  })
  .refine((v) => v.text.trim().length > 0 || (v.attachmentIds?.length ?? 0) > 0, {
    message: "a message needs text or an attachment",
  });
export type ChatSendInput = z.infer<typeof chatSendInput>;

/**
 * Ask for a presigned upload target (09 §storage). The server enforces the
 * per-kind byte/duration caps here and returns the attachment row id + a URL the
 * client PUTs the bytes to — never through the function (Blob's 4.5MB body limit).
 */
export const createUploadUrlInput = z.object({
  kind: attachmentKindSchema,
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  filename: z.string().max(255).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
});
export type CreateUploadUrlInput = z.infer<typeof createUploadUrlInput>;

/** The client telling the server its PUT finished, so ingest can start (09). */
export const attachmentUploadedInput = z.object({ attachmentId: z.string().uuid() });
export type AttachmentUploadedInput = z.infer<typeof attachmentUploadedInput>;

/** Poll one attachment's ingest status (09 — client gates send on `ready`). */
export const attachmentStatusInput = z.object({
  attachmentIds: z.array(z.string().uuid()).min(1).max(4),
});
export type AttachmentStatusInput = z.infer<typeof attachmentStatusInput>;

/** Re-run ingest for a `failed` attachment (09 §retry). */
export const retryAttachmentInput = z.object({ attachmentId: z.string().uuid() });
export type RetryAttachmentInput = z.infer<typeof retryAttachmentInput>;

/** `read_attachment` tool argument (09 §read_attachment). */
export const readAttachmentInput = z.object({ attachment_id: z.string().uuid() });
export type ReadAttachmentInput = z.infer<typeof readAttachmentInput>;

/** The app returning a device-tool's result mid-turn (12-life-integrations.md). */
export const deviceToolResultInput = z.object({
  conversationId: z.string().uuid(),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  result: z.unknown(),
});
export type DeviceToolResultInput = z.infer<typeof deviceToolResultInput>;

/**
 * Resume a turn after its device-tools have posted results (12). Carries no user
 * text — the model re-reads the now-complete tool-call/result rows and streams the
 * follow-up assistant text as the same logical turn.
 */
export const chatContinueInput = z.object({ conversationId: z.string().uuid() });
export type ChatContinueInput = z.infer<typeof chatContinueInput>;

/** Keyset pagination over the immutable message log (08). */
export const chatHistoryInput = z.object({
  conversationId: z.string().uuid(),
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ChatHistoryInput = z.infer<typeof chatHistoryInput>;

/** Centered window around a message for jump-to-date / search deep links (08). */
export const chatHistoryAroundInput = z.object({
  conversationId: z.string().uuid(),
  messageId: z.number().int().positive(),
  span: z.number().int().min(1).max(50).default(25),
});
export type ChatHistoryAroundInput = z.infer<typeof chatHistoryAroundInput>;

/** Full-text search over a conversation's messages (08 §message search). */
export const chatSearchInput = z.object({
  conversationId: z.string().uuid(),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(25),
});
export type ChatSearchInput = z.infer<typeof chatSearchInput>;

/** "What my sidekick knows" surface (user-memory.md §7). */
export const memoryForgetInput = z.object({ memoryId: z.string().uuid() });
export type MemoryForgetInput = z.infer<typeof memoryForgetInput>;

export const memoryEditInput = z.object({
  memoryId: z.string().uuid(),
  content: z.string().min(1),
});
export type MemoryEditInput = z.infer<typeof memoryEditInput>;

/** Start a guided deep talk (14 §runner). */
export const deepTalkStartInput = z.object({ slug: z.string().min(1) });
export type DeepTalkStartInput = z.infer<typeof deepTalkStartInput>;

/** Settle any just-completed deep talk in a conversation (streaming-path hook). */
export const deepTalkFinishInput = z.object({ conversationId: z.string().uuid() });
export type DeepTalkFinishInput = z.infer<typeof deepTalkFinishInput>;

/** Stage a ChatGPT paste import for review (14 §import path 1). */
export const chatgptImportStageInput = z.object({ text: z.string().min(1).max(20000) });
export type ChatgptImportStageInput = z.infer<typeof chatgptImportStageInput>;

/** One staged import candidate the user reviews before commit (14 §import). */
export const importCandidateSchema = z.object({
  kind: memoryKindSchema,
  content: z.string().min(1),
  confidence: z.enum(["stated", "inferred"]),
});
export type ImportCandidateInput = z.infer<typeof importCandidateSchema>;

/** Commit the checked subset of a staged import. */
export const chatgptImportCommitInput = z.object({
  candidates: z.array(importCandidateSchema).max(60),
});
export type ChatgptImportCommitInput = z.infer<typeof chatgptImportCommitInput>;
