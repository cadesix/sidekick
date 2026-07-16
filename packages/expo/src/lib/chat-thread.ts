/** An attachment on a thread message, with a fetchable URL (09). */
export type MessageAttachment = {
  id: string;
  /** "image" | "audio" | "file" — string to match the server payload verbatim. */
  kind: string;
  mime: string;
  bytes: number;
  url: string;
  caption: string | null;
  transcript: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: string;
};

/** The render payload for a sponsored card (05 / 07 §8), from the server ad row. */
export type AdView = {
  adUnitId: string;
  brandName: string;
  faviconUrl: string | null;
  title: string;
  body: string;
  cta: string;
  clickUrl: string;
};

/**
 * The client's view of a message. tRPC serializes the server's `Date` to an ISO
 * string over the wire (no superjson transformer configured), so `createdAt` is a
 * string here. Kept RN-free and unit-tested.
 */
export type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  adUnitId: string | null;
  /** The sponsored-card payload when this row is an ad (`adUnitId` set). */
  ad?: AdView | null;
  /** AI SDK tool-call array persisted on assistant rows (drives chat chrome). */
  toolCalls?: unknown;
  attachments?: MessageAttachment[];
};

export function activeComposerAd(
  messages: { role: string; adUnitId: string | null; ad?: AdView | null }[],
): AdView | undefined {
  const newest = messages.find((message) => message.role === "user" || message.role === "assistant");
  if (!newest?.adUnitId) {
    return undefined;
  }
  return newest.ad ?? undefined;
}
