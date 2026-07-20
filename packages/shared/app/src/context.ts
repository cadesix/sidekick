import { eq } from "drizzle-orm";
import type { AssistantContent, ModelMessage, ToolContent, UserContent } from "ai";
import { type Database, conversations } from "@sidekick/db";
import {
  FILE_FULLTEXT_WINDOW_MESSAGES,
  PDF_DOCUMENT_MAX_BYTES,
  RECENT_IMAGE_LIMIT,
} from "./attachments";
import {
  type TailAttachment,
  type TailMessage,
  latestSummary,
  tailMessages,
} from "./conversation";
import { type DeepTalk, activeDeepTalk } from "./deep-talks";
import { renderMemoryBlock } from "./memory/render";
import {
  ONBOARDING_CHAT_PROMPT,
  onboardingChatState,
  renderHabitBlock,
  renderOnboardingBlock,
} from "./onboarding-chat";
import { PERSONA_PROMPT } from "./prompts/persona";
import { capabilities, selectGuidance } from "./tools";
import type { FeatureFlags } from "./tools/registry";

/**
 * A block of the system prompt. Blocks map to Anthropic cache breakpoints
 * (08 §context assembly): `persona` is breakpoint A (never invalidates between
 * deploys); `memory` and `summary` share breakpoint B — whichever is last in the
 * pair carries `cache: true`.
 */
export type SystemBlock = {
  id: "persona" | "guidance" | "memory" | "summary" | "deep_talk" | "onboarding";
  text: string;
  /** Set a cache breakpoint after this block. */
  cache?: boolean;
};

export type ContextView = {
  system: SystemBlock[];
  /** The verbatim tail as AI SDK messages, tool pairs + attachments reconstructed. */
  messages: ModelMessage[];
  promptVersion: string;
};

/** Resolves an attachment's `storageKey` to a URL the model can fetch (09). */
export type StorageUrl = (storageKey: string) => string;

export type BuildContextOptions = {
  now?: Date;
  /**
   * Turns a `storageKey` into a public URL for image/PDF content parts. Defaults
   * to identity so tests can assert the key; production injects `storage.publicUrl`.
   */
  storageUrl?: StorageUrl;
  /**
   * The user's feature flags, so per-capability prompt guidance is only included
   * for enabled capabilities. Defaults to all-enabled.
   */
  flags?: FeatureFlags;
};

/** 08's insert-time token estimate: ~4 chars per token. */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/** 08 §data model constants. */
export const TAIL_TARGET_TOKENS = 8_000;
export const TAIL_MAX_TOKENS = 24_000;

const EARLIER_HEADER = "=== EARLIER IN THIS CONVERSATION ===";

/**
 * The dynamic ACTIVE DEEP TALK block (14 runner). Injected only while a session is
 * active; its beats steer the model to work the topic one beat at a time and to
 * call `complete_deep_talk` when done. It sits in the volatile region B alongside
 * the memory block — stable through a session, so it costs one cache break on
 * start and one on completion, never mid-session.
 */
function renderDeepTalkBlock(talk: DeepTalk): string {
  const beats = talk.beats.map((beat) => `- ${beat}`).join("\n");
  return `=== ACTIVE DEEP TALK: ${talk.title} ===
work through these beats naturally, one at a time, reacting like a friend, not an
interviewer; drop any beat that doesn't land; follow the user if they redirect —
the beats are a map, not a script. wrap up warmly when they're covered or the user
wants out, then call complete_deep_talk with slug "${talk.slug}".
beats:
${beats}
=== END ===`;
}

type ParsedToolCall = { toolCallId: string; toolName: string; input: unknown };

/**
 * Read the persisted `tool_calls` jsonb (AI SDK tool-call array on assistant rows,
 * or the `[{toolCallId, toolName}]` marker on tool rows) into a typed shape,
 * tolerating whatever the writer stored. Anything unrecognized is skipped.
 */
function parseToolCalls(raw: unknown): ParsedToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const calls: ParsedToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const toolCallId = record.toolCallId;
    const toolName = record.toolName;
    if (typeof toolCallId === "string" && typeof toolName === "string") {
      calls.push({ toolCallId, toolName, input: record.input ?? {} });
    }
  }
  return calls;
}

/** Best-effort URL for a content part; falls back to the raw string if unparseable. */
function toUrl(value: string): URL | string {
  try {
    return new URL(value);
  } catch {
    return value;
  }
}

/** Original filename from the storage key's last path segment (09). */
function fileName(attachment: TailAttachment): string {
  const segment = attachment.storageKey.split("/").pop() ?? attachment.storageKey;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function captionText(attachment: TailAttachment): string {
  return attachment.caption ?? "attachment";
}

/**
 * Build one user message's content parts under the 09 view rules:
 * - images: real image parts for the 3 most-recent thread-wide, older → `[photo: caption]`;
 * - voice: the transcript, prefixed `[voice note] ` (the audio never goes to the model);
 * - files: full extracted text (fenced) while inside the recency window, else
 *   `[file: name — caption]`; PDFs within the size cap ride up as native document
 *   parts for better table/layout comprehension.
 */
function userContent(
  message: TailMessage,
  recentImageIds: Set<string>,
  fileFullText: boolean,
  storageUrl: StorageUrl,
): UserContent {
  const parts: Exclude<UserContent, string> = [];
  const text = message.content.trim();
  if (text.length > 0) {
    parts.push({ type: "text", text: message.content });
  }

  for (const attachment of message.attachments) {
    if (attachment.kind === "image") {
      if (recentImageIds.has(attachment.id)) {
        parts.push({
          type: "image",
          image: toUrl(storageUrl(attachment.storageKey)),
          mediaType: attachment.mime,
        });
      } else {
        parts.push({ type: "text", text: `[photo: ${captionText(attachment)}]` });
      }
      continue;
    }

    if (attachment.kind === "audio") {
      const transcript = attachment.transcript ?? "";
      parts.push({ type: "text", text: `[voice note] ${transcript}`.trimEnd() });
      continue;
    }

    const name = fileName(attachment);
    const isPdf = attachment.mime === "application/pdf";
    if (fileFullText && isPdf && attachment.bytes <= PDF_DOCUMENT_MAX_BYTES) {
      parts.push({
        type: "file",
        data: toUrl(storageUrl(attachment.storageKey)),
        mediaType: "application/pdf",
        filename: name,
      });
      continue;
    }
    if (fileFullText && attachment.extractedText) {
      parts.push({
        type: "text",
        text: `\`\`\`${name}\n${attachment.extractedText}\n\`\`\``,
      });
      continue;
    }
    parts.push({ type: "text", text: `[file: ${name} — ${captionText(attachment)}]` });
  }

  if (parts.length === 0) {
    return message.content;
  }
  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text;
  }
  return parts;
}

/**
 * Reconstruct the verbatim tail as AI SDK `ModelMessage`s (08/09/12). User rows
 * apply the attachment view rules; assistant rows carry tool-call parts and tool
 * rows carry tool-result parts — but only for tool-calls that have a matching
 * result row *inside the tail*. A server tool that resolved inside its own turn
 * has no result row, so its call is dropped to keep the message stream valid;
 * an orphan tool result (its call summarized away) is likewise dropped. Tool
 * results round-trip as opaque JSON `output` values — a provider-executed
 * `web_search` result (sources and all) passes through untouched.
 */
export function assembleTail(tail: TailMessage[], storageUrl: StorageUrl): ModelMessage[] {
  const imageIds: string[] = [];
  for (const message of tail) {
    for (const attachment of message.attachments) {
      if (attachment.kind === "image") {
        imageIds.push(attachment.id);
      }
    }
  }
  const recentImageIds = new Set(imageIds.slice(-RECENT_IMAGE_LIMIT));

  const resolvedCallIds = new Set<string>();
  for (const message of tail) {
    if (message.role === "tool") {
      for (const call of parseToolCalls(message.toolCalls)) {
        resolvedCallIds.add(call.toolCallId);
      }
    }
  }

  const messages: ModelMessage[] = [];
  const pendingCallIds = new Set<string>();

  tail.forEach((message, index) => {
    const withinFileWindow = tail.length - 1 - index < FILE_FULLTEXT_WINDOW_MESSAGES;

    if (message.role === "user") {
      messages.push({
        role: "user",
        content: userContent(message, recentImageIds, withinFileWindow, storageUrl),
      });
      return;
    }

    if (message.role === "assistant") {
      const toolCallParts: Exclude<AssistantContent, string> = [];
      for (const call of parseToolCalls(message.toolCalls)) {
        if (resolvedCallIds.has(call.toolCallId)) {
          toolCallParts.push({
            type: "tool-call",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          });
          pendingCallIds.add(call.toolCallId);
        }
      }
      if (toolCallParts.length === 0) {
        messages.push({ role: "assistant", content: message.content });
        return;
      }
      const content: Exclude<AssistantContent, string> = [];
      if (message.content.trim().length > 0) {
        content.push({ type: "text", text: message.content });
      }
      content.push(...toolCallParts);
      messages.push({ role: "assistant", content });
      return;
    }

    if (message.role === "tool") {
      const resultParts: ToolContent = [];
      for (const call of parseToolCalls(message.toolCalls)) {
        if (!pendingCallIds.has(call.toolCallId)) {
          continue;
        }
        pendingCallIds.delete(call.toolCallId);
        resultParts.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: parseToolOutput(message.content),
        });
      }
      if (resultParts.length > 0) {
        messages.push({ role: "tool", content: resultParts });
      }
    }
  });

  return messages;
}

/**
 * A persisted tool-result body → an AI SDK tool-result `output`. The stored string
 * is a JSON-serialized result value; it round-trips as a `json` output (opaque —
 * we never inspect it), falling back to `text` for a non-JSON body.
 */
function parseToolOutput(content: string): ToolContent[number]["output"] {
  try {
    return { type: "json", value: JSON.parse(content) };
  } catch {
    return { type: "text", value: content };
  }
}

/**
 * Assemble the LLM's view of a conversation from the DB — the derived view of 08
 * invariant 2, rebuilt every turn:
 *
 *   [1] persona prompt                    ← breakpoint A
 *   [2] memory block (user-memory.md §3)
 *   [3] EARLIER IN THIS CONVERSATION      ← breakpoint B (shared with [2])
 *       <latest rolling summary, omitted entirely if none>
 *   [4] verbatim tail: messages id > coversToMessageId, ad messages excluded,
 *       tool pairs + attachments (09) reconstructed
 *   [5] the new user message (already persisted, so it lands as the last tail row)
 *
 * `now` is injectable so tests get deterministic relative-date rendering; in
 * production it defaults to the request time (rounded to the local day inside the
 * memory renderer, per the cache rules).
 */
export async function buildContextView(
  db: Database,
  conversationId: string,
  options: BuildContextOptions = {},
): Promise<ContextView> {
  const now = options.now ?? new Date();
  const storageUrl = options.storageUrl ?? ((key) => key);

  const conversationRows = await db
    .select({ userId: conversations.userId, kind: conversations.kind })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const userId = conversationRows[0]?.userId ?? null;

  /**
   * Onboarding conversations (02 §onboarding chat) get their own, much smaller
   * view: persona + the ONBOARDING SETUP CHAT block over the verbatim tail. No
   * memory (it's being seeded right now), no summary (the chat is short-lived by
   * construction), no capability guidance (the tool set is restricted to the
   * onboarding tools). Persona keeps cache breakpoint A; the onboarding block is
   * beat-derived and volatile, so it takes no breakpoint — the whole conversation
   * fits in one cheap request anyway.
   */
  if (conversationRows[0]?.kind === "onboarding" && userId !== null) {
    const [state, onboardingTail] = await Promise.all([
      onboardingChatState(db, userId),
      tailMessages(db, conversationId, 0),
    ]);
    return {
      system: [
        { id: "persona", text: PERSONA_PROMPT.text, cache: true },
        { id: "onboarding", text: renderOnboardingBlock(state) },
      ],
      messages: assembleTail(onboardingTail, storageUrl),
      promptVersion: ONBOARDING_CHAT_PROMPT.version,
    };
  }

  // The goal-screen "+" habit-add chat — same small view, a static add-habit block
  // (no beat machine; completion is signalled by the commit_habit tool call).
  if (conversationRows[0]?.kind === "habit" && userId !== null) {
    const habitTail = await tailMessages(db, conversationId, 0);
    return {
      system: [
        { id: "persona", text: PERSONA_PROMPT.text, cache: true },
        { id: "onboarding", text: renderHabitBlock() },
      ],
      messages: assembleTail(habitTail, storageUrl),
      promptVersion: ONBOARDING_CHAT_PROMPT.version,
    };
  }

  const [summary, memoryText, deepTalk] = await Promise.all([
    latestSummary(db, conversationId),
    userId ? renderMemoryBlock(db, userId, now) : Promise.resolve(""),
    activeDeepTalk(db, conversationId, now),
  ]);
  const tail = await tailMessages(db, conversationId, summary?.coversToMessageId ?? 0);

  const messagesView = assembleTail(tail, storageUrl);

  const guidance = selectGuidance(capabilities, options.flags ?? {});

  /**
   * Persona + capability guidance form the static region behind breakpoint A —
   * the cache breakpoint lands after the *last* static block (guidance if any,
   * else persona) so guidance stays inside the never-invalidating region. Memory +
   * the active deep-talk block + summary form the volatile region B (08 §context
   * assembly); whichever region-B block is last carries breakpoint B.
   */
  const regionB: SystemBlock[] = [];
  if (memoryText.length > 0) {
    regionB.push({ id: "memory", text: memoryText });
  }
  if (deepTalk !== null) {
    regionB.push({ id: "deep_talk", text: renderDeepTalkBlock(deepTalk) });
  }
  if (summary !== null) {
    regionB.push({ id: "summary", text: `${EARLIER_HEADER}\n${summary.content}` });
  }

  const system: SystemBlock[] = [
    { id: "persona", text: PERSONA_PROMPT.text, cache: guidance.length === 0 },
  ];
  guidance.forEach((text, index) => {
    system.push({ id: "guidance", text, cache: index === guidance.length - 1 });
  });
  regionB.forEach((block, index) => {
    system.push({ ...block, cache: index === regionB.length - 1 });
  });

  return { system, messages: messagesView, promptVersion: PERSONA_PROMPT.version };
}

/** Flatten system blocks to a single string for `streamText({ system })`. */
export function renderSystem(blocks: SystemBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

/**
 * Token estimate of one attachment's injected expansion, mirroring the maximal
 * strings `userContent` renders (fenced extract / voice transcript / caption
 * placeholder). Added onto the carrying message's `tokenEstimate` at insert time
 * so the 8k/24k tail budgets (08) account for attachment-heavy turns instead of
 * counting only the typed text. Deliberately ignores the recency windowing —
 * budgeting for the largest form keeps the estimate `ceil(len/4)`-simple and
 * errs toward compacting sooner, never later.
 */
export function attachmentExpansionTokens(attachment: {
  kind: string;
  storageKey: string;
  caption: string | null;
  transcript: string | null;
  extractedText: string | null;
}): number {
  const caption = attachment.caption ?? "attachment";
  if (attachment.kind === "image") {
    return estimateTokens(`[photo: ${caption}]`);
  }
  if (attachment.kind === "audio") {
    return estimateTokens(`[voice note] ${attachment.transcript ?? ""}`);
  }
  const name = attachment.storageKey.split("/").pop() ?? attachment.storageKey;
  if (attachment.extractedText) {
    return estimateTokens(`\`\`\`${name}\n${attachment.extractedText}\n\`\`\``);
  }
  return estimateTokens(`[file: ${name} — ${caption}]`);
}
