/**
 * Suggested reply chips (07 §2 reply chips, flag `suggested_replies`). After an
 * assistant turn completes, one cheap post-hoc model call proposes 0–3 short
 * tappable replies in the USER's voice. The result rides the chat stream as a
 * control frame (same ``-delimited scheme as the search frames) and the
 * `chat.send` outcome, so both transports carry it.
 */
export const SUGGESTED_REPLIES_PROMPT = { version: "suggested-replies-v1" } as const;

/** Hard bounds: never more than 3 chips, never a paragraph-sized chip. */
export const MAX_SUGGESTED_REPLIES = 3;
const MAX_REPLY_LENGTH = 60;

const FRAME_DELIMITER = "";
export const STREAM_META_PREFIX = `${FRAME_DELIMITER}stream-meta:`;
export const STREAM_META_DELIMITER = FRAME_DELIMITER;

/** End-of-stream metadata: reply chips + (onboarding only) the current beat. */
export type StreamMeta = { replies: string[]; beat?: string };

export function encodeStreamMeta(meta: StreamMeta): string {
  return `${STREAM_META_PREFIX}${JSON.stringify(meta)}${FRAME_DELIMITER}`;
}

/**
 * Mid-stream device-tool frame (12-life-integrations.md). When the model emits
 * client Focus tool-calls the server writes this frame into the
 * chat stream — same ``-delimited scheme as the search + meta frames — so
 * the app can run the native op and post results back. The payload is the JSON
 * array of `{ toolCallId, toolName, input }` calls.
 */
export const DEVICE_TOOL_PREFIX = `${FRAME_DELIMITER}device-tool:`;

export type DeviceToolFrameCall = { toolCallId: string; toolName: string; input: unknown };

export function encodeDeviceToolCalls(calls: DeviceToolFrameCall[]): string {
  return `${DEVICE_TOOL_PREFIX}${JSON.stringify(calls)}${FRAME_DELIMITER}`;
}

/**
 * Parse one full device-tool frame body (the JSON array between prefix and
 * closing delimiter). Returns null for anything malformed and drops individual
 * entries missing a string `toolCallId`/`toolName` — a bad frame must never
 * crash the reader or run a phantom tool.
 */
export function decodeDeviceToolCalls(payload: string): DeviceToolFrameCall[] | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const calls: DeviceToolFrameCall[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.toolCallId === "string" && typeof record.toolName === "string") {
        calls.push({ toolCallId: record.toolCallId, toolName: record.toolName, input: record.input });
      }
    }
    return calls;
  } catch {
    return null;
  }
}

/**
 * Parse one full stream-meta frame body (the JSON between prefix and closing
 * delimiter). Returns null for anything malformed — a bad frame must never
 * surface as chat text or crash the reader.
 */
export function decodeStreamMeta(payload: string): StreamMeta | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.replies)) {
      return null;
    }
    const replies = record.replies.filter((r): r is string => typeof r === "string");
    const beat = record.beat;
    if (typeof beat === "string") {
      return { replies, beat };
    }
    return { replies };
  } catch {
    return null;
  }
}

export type SuggestedRepliesInput = {
  userText: string;
  assistantText: string;
  /** Deterministic choices the app knows fit (onboarding catalog options). */
  optionHints: string[];
};

export function renderSuggestedRepliesPrompt(input: SuggestedRepliesInput): string {
  const hints =
    input.optionHints.length > 0
      ? `\nThe app suggests these specific choices fit the current step: ${JSON.stringify(input.optionHints)}. Prefer them (verbatim) when they answer the assistant's question; ignore them when they don't.`
      : "";
  return `You generate tappable quick-reply chips for a chat app. The assistant is the user's "sidekick"; the USER is the one tapping.

User's last message: ${JSON.stringify(input.userText)}
Assistant's reply: ${JSON.stringify(input.assistantText)}
${hints}
Produce a JSON array of 0 to ${MAX_SUGGESTED_REPLIES} short replies the USER might tap next, in the user's casual voice: lowercase, at most six words each, no punctuation-heavy sentences. If the assistant's message doesn't invite a quick pick (it needs a real, personal answer, or it's just a statement), return [].

Output ONLY the JSON array, nothing else.`;
}

/** Model output → validated chip list: strings only, trimmed, bounded. */
export function parseSuggestedReplies(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.length <= MAX_REPLY_LENGTH)
      .slice(0, MAX_SUGGESTED_REPLIES);
  } catch {
    return [];
  }
}
