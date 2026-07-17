import { z } from "zod";
import { attachmentKindSchema } from "./attachments";
import { memoryKindSchema } from "./memory/ops";

export const messageRole = z.enum(["user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof messageRole>;

export type ReactionType =
  | "heart"
  | "thumbsUp"
  | "thumbsDown"
  | "haha"
  | "exclamation"
  | "question"
  | `emoji:${string}`;
export type Reaction = { type: ReactionType; from: "me" | "them" };

const namedReactionTypes = new Set<string>([
  "heart",
  "thumbsUp",
  "thumbsDown",
  "haha",
  "exclamation",
  "question",
]);

export const reactionTypeSchema = z.custom<ReactionType>(
  (value) =>
    typeof value === "string" &&
    (namedReactionTypes.has(value) || /^emoji:.+$/u.test(value)),
  "invalid reaction type",
);

/** Post-auth device metadata upsert (19-auth.md). */
export const registerDeviceInput = z.object({
  deviceId: z.string().min(1),
  publicKey: z.string().optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceInput>;

/** E.164 phone number (19-auth.md): a leading `+` and up to 15 digits. */
const e164Phone = z.string().regex(/^\+[1-9]\d{1,14}$/, "invalid phone number");
/** A 6-digit OTP (19-auth.md). */
const otpCode = z.string().regex(/^\d{6}$/, "invalid code");

/** Apple sign-in: an identity token verified server-side (19-auth.md). */
export const appleAuthInput = z.object({
  identityToken: z.string().min(1),
  platform: z.enum(["ios", "web"]).default("ios"),
});
export type AppleAuthInput = z.infer<typeof appleAuthInput>;

/** Google sign-in: an id_token verified server-side (19-auth.md). */
export const googleAuthInput = z.object({ idToken: z.string().min(1) });
export type GoogleAuthInput = z.infer<typeof googleAuthInput>;

/** Request an email OTP (19-auth.md). */
export const emailAuthInput = z.object({ email: z.string().email() });
export type EmailAuthInput = z.infer<typeof emailAuthInput>;

/** Verify an email OTP (19-auth.md). */
export const verifyEmailCodeInput = z.object({ email: z.string().email(), code: otpCode });
export type VerifyEmailCodeInput = z.infer<typeof verifyEmailCodeInput>;

/** Request an SMS OTP (19-auth.md). */
export const phoneAuthInput = z.object({ phone: e164Phone });
export type PhoneAuthInput = z.infer<typeof phoneAuthInput>;

/** Verify an SMS OTP (19-auth.md). */
export const verifyPhoneCodeInput = z.object({ phone: e164Phone, code: otpCode });
export type VerifyPhoneCodeInput = z.infer<typeof verifyPhoneCodeInput>;

export const chatSendInput = z
  .object({
    conversationId: z.string().uuid(),
    text: z.string().default(""),
    attachmentIds: z.array(z.string().uuid()).max(4).optional(),
    replyToId: z.number().int().positive().optional(),
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
export const attachmentUploadedInput = z.object({
  attachmentId: z.string().uuid(),
  waveform: z.array(z.number().min(0).max(1)).optional(),
});
export type AttachmentUploadedInput = z.infer<typeof attachmentUploadedInput>;

export const chatReactInput = z.object({
  messageId: z.number().int().positive(),
  type: reactionTypeSchema.nullable(),
});
export type ChatReactInput = z.infer<typeof chatReactInput>;

export const chatDeleteMessageInput = z.object({
  messageId: z.number().int().positive(),
});
export type ChatDeleteMessageInput = z.infer<typeof chatDeleteMessageInput>;

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

/** One catalog cosmetic by its renderKey — equip, unequip, purchase (plan 20). */
export const cosmeticItemInput = z.object({ itemKey: z.string().min(1) });
export type CosmeticItemInput = z.infer<typeof cosmeticItemInput>;

/** A user-local `YYYY-MM-DD` day (plan 20 — the GoalsSheet toggle's date). */
export const localDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid date");

/**
 * The GoalsSheet's manual weekly toggle (plan 20 decision 8): mark a day's
 * outcome for a goal, or clear it with `result: null` (the toggle-off
 * round-trip). Shares the chat `log_checkin` write path, tagged `manual`.
 */
export const logCheckInInput = z.object({
  goalId: z.string().uuid(),
  date: localDay,
  result: z.enum(["hit", "missed", "partial", "skipped"]).nullable(),
});
export type LogCheckInInput = z.infer<typeof logCheckInInput>;

/**
 * A real IANA timezone (plan 20 decision 6). Every write to `users.timezone`
 * validates through this — date-keyed faucets (daily box, streak, shop
 * rotation) trust the column, so garbage zones must never land. Anything
 * `Intl.DateTimeFormat` accepts is a zone `localDate` can compute with.
 */
export const ianaTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "invalid timezone");

/** One `#rrggbb` cel color. */
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "invalid color");

/** The sidekick's skin — cel body color plus its darker shadow tint (plan 20). */
export const setSkinInput = z.object({ body: hexColor, shadow: hexColor });
export type SetSkinInput = z.infer<typeof setSkinInput>;

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

/**
 * A poetic 2-4 word title. Real ones run ~19-25 chars ("the restless
 * cartographer"), so this only bites a model that ignored the prompt — but it
 * cuts on a word boundary rather than mid-word, because the result is shown to
 * the user and spoken over the sidekick's head. (SessionChat's cap, re-applied
 * server-side on what `sessions.complete` persists — plan 20 decision 9.)
 */
const ARCHETYPE_MAX = 48;

function capArchetype(s: string): string {
  if (s.length <= ARCHETYPE_MAX) return s;
  const cut = s.slice(0, ARCHETYPE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

/**
 * The astral card (plan 20): the user's running "personality reading", rewritten
 * each completed session from the whole profile. Transforms mirror the client's
 * sanitizers: archetype trimmed + word-boundary capped, traits trimmed with
 * blanks dropped and at most 4 kept.
 */
export const sessionAstralSchema = z.object({
  archetype: z.string().trim().min(1).transform(capArchetype),
  reading: z.string().trim().min(1),
  traits: z
    .array(z.string())
    .transform((traits) =>
      traits
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 4),
    ),
});
export type SessionAstral = z.infer<typeof sessionAstralSchema>;

/** What the extraction pass hands `sessions.complete` to persist (plan 20). */
export const sessionExtractionSchema = z.object({
  fields: z.record(z.string()),
  notes: z.array(z.object({ tag: z.string().min(1), text: z.string().min(1) })),
  /** Absent/null = this session produced no card; the stored one survives untouched. */
  astral: sessionAstralSchema.nullish(),
});
export type SessionExtraction = z.infer<typeof sessionExtractionSchema>;

/** Persist guided-session progress after every answer (plan 20 decision 9). */
export const sessionProgressInput = z.object({
  sessionId: z.string().min(1),
  beat: z.number().int().min(0),
  answers: z.array(z.string()),
});
export type SessionProgressInput = z.infer<typeof sessionProgressInput>;

/** One LLM acknowledgment of the just-stored answer; the ask comes from core's script. */
export const sessionAckInput = z.object({
  sessionId: z.string().min(1),
  answer: z.string().min(1),
  probe: z.boolean().optional(),
});
export type SessionAckInput = z.infer<typeof sessionAckInput>;

/** Run (or re-run, with recap corrections) the extraction pass over stored answers. */
export const sessionExtractInput = z.object({
  sessionId: z.string().min(1),
  corrections: z.array(z.string().min(1)).optional(),
});
export type SessionExtractInput = z.infer<typeof sessionExtractInput>;

/** Complete a session: persist the confirmed extraction, pay catalog rewards. */
export const sessionCompleteInput = z.object({
  sessionId: z.string().min(1),
  extraction: sessionExtractionSchema,
});
export type SessionCompleteInput = z.infer<typeof sessionCompleteInput>;
