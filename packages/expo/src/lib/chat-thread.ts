import { dayLabel, localDayKey } from "./date";

/**
 * The client's view of a message. tRPC serializes the server's `Date` to an ISO
 * string over the wire (no superjson transformer configured), so `createdAt` is a
 * string here. Kept RN-free and unit-tested.
 */
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

export type ChatRow =
  | { type: "message"; key: string; message: ChatMessage }
  | { type: "separator"; key: string; label: string; date: string };

export function activeComposerAd(
  messages: { role: string; adUnitId: string | null; ad?: AdView | null }[],
): AdView | undefined {
  const newest = messages.find((message) => message.role === "user" || message.role === "assistant");
  if (!newest?.adUnitId) {
    return undefined;
  }
  return newest.ad ?? undefined;
}

/**
 * Merge the pages of a keyset-paginated infinite query into one newest-first
 * list, de-duplicating by id (a streamed reply that later lands in `history` can
 * appear in two pages). Order is preserved from the pages, which arrive
 * newest-first (08 client UX).
 */
export function mergeHistoryPages(pages: ChatMessage[][]): ChatMessage[] {
  const seen = new Set<number>();
  const merged: ChatMessage[] = [];
  for (const page of pages) {
    for (const message of page) {
      if (seen.has(message.id)) {
        continue;
      }
      seen.add(message.id);
      merged.push(message);
    }
  }
  return merged;
}

/**
 * The cursor for the next (older) page: the id of the oldest message in the last
 * page, or `undefined` when the page was short — meaning there is no more
 * history. Feeds React Query's `getNextPageParam`.
 */
export function getNextCursor(lastPage: ChatMessage[], limit: number): number | undefined {
  if (lastPage.length < limit) {
    return undefined;
  }
  const oldest = lastPage[lastPage.length - 1];
  return oldest?.id;
}

/**
 * Turn a newest-first message list into the rows an inverted FlatList renders,
 * inserting a client-side day separator above the first message of each local
 * day (08 client UX). Tool messages are dropped — they carry no user-visible
 * text. Output stays newest-first (row 0 renders at the visual bottom).
 */
export function buildChatRows(messages: ChatMessage[], now: Date): ChatRow[] {
  const visible = messages.filter((m) => m.role !== "tool" && m.adUnitId === null);
  const chronological = [...visible].reverse();
  const rows: ChatRow[] = [];
  let previousDayKey: string | null = null;
  for (const message of chronological) {
    const date = new Date(message.createdAt);
    const key = localDayKey(date);
    if (key !== previousDayKey) {
      rows.push({
        type: "separator",
        key: `sep-${key}`,
        label: dayLabel(date, now),
        date: message.createdAt,
      });
      previousDayKey = key;
    }
    rows.push({ type: "message", key: `msg-${message.id}`, message });
  }
  return rows.reverse();
}

/** Accumulate streamed text deltas into the assistant reply (streaming reducer). */
export function reduceStream(deltas: string[]): string {
  return deltas.join("");
}
