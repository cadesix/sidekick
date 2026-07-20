import {
  streamChatContinuation,
  streamChatTurn,
  trpc,
  uploadAttachment,
} from "~/lib/api";
import { runDeviceToolCalls } from "~/features/chat/device-tools";
import { activeComposerAd, type AdView } from "~/lib/chat-thread";
import { filenameFromUrl } from "./lib/attachments";
import type {
  AudioAttachment,
  FileAttachment,
  GameCard,
  ImageAttachment,
  Message,
  ReactionType,
  Thread,
} from "./types";

/**
 * The chat's server stitch. The transcript lives in Postgres (the sidekick's
 * memory, check-ins and device tools all read it), so the UI's `Message` shape
 * is mapped to and from `chat.history` here rather than kept in a local store.
 */

type HistoryRow = Awaited<ReturnType<typeof trpc.chat.history.query>>[number];

/**
 * Safety ceiling on device-tool ↔ continuation rounds within one turn. A real
 * turn resolves in one round; this bounds a model that keeps calling them.
 */
const MAX_DEVICE_TOOL_ROUNDS = 4;

/** Sidekick is a single character, so the thread is a constant, not a row. */
export const SIDEKICK_THREAD: Omit<Thread, "id"> = {
  name: "Sidekick",
  avatarInitials: "S",
  avatarColor: "#F5A623",
  subtitle: "Always here",
  systemPrompt: "",
  createdAt: 0,
};

export function sidekickThread(conversationId: string): Thread {
  return { ...SIDEKICK_THREAD, id: conversationId };
}

function toAudio(row: HistoryRow): AudioAttachment | undefined {
  const voice = row.attachments.find((attachment) => attachment.kind === "audio");
  if (!voice) {
    return undefined;
  }
  return {
    uri: voice.url,
    durationSec: (voice.durationMs ?? 0) / 1000,
    waveform: voice.waveform ?? [],
  };
}

function toImages(row: HistoryRow): ImageAttachment[] {
  return row.attachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => ({
      uri: attachment.url,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
    }));
}

function toFile(row: HistoryRow): FileAttachment | undefined {
  const file = row.attachments.find((attachment) => attachment.kind === "file");
  if (!file) {
    return undefined;
  }
  return {
    url: file.url,
    filename: filenameFromUrl(file.url),
    mime: file.mime,
    bytes: file.bytes,
  };
}

function toGame(row: HistoryRow, latest: boolean): GameCard | undefined {
  if (!row.game) {
    return undefined;
  }
  return {
    matchId: row.game.matchId,
    gameType: row.game.gameType,
    status: row.game.status,
    yourMove: row.game.yourMove,
    winner: row.game.winner,
    latest: row.game.latest || latest,
    summary: row.game.summary,
  };
}

/** A persisted row → the bubble the transcript renders. */
function toMessage(row: HistoryRow, latestGame: boolean): Message {
  const audio = toAudio(row);
  const game = toGame(row, latestGame);
  let kind: Message["kind"] = "text";
  if (game) {
    kind = "game";
  } else if (audio) {
    kind = "audio";
  }
  return {
    id: String(row.id),
    threadId: row.conversationId,
    role: row.role === "user" ? "me" : "them",
    text: row.content,
    createdAt: new Date(row.createdAt).getTime(),
    status: row.role === "user" ? "read" : undefined,
    replyToId: row.replyToId === null ? undefined : String(row.replyToId),
    reactions: row.reactions,
    kind,
    audio,
    images: toImages(row),
    file: toFile(row),
    game,
  };
}

// A split bubble carries the id `${rowId}.${k}`; server ops key off the real row.
function rowId(messageId: string): number {
  return Number(messageId.split(".")[0]);
}

// Keep split bubbles within one iMessage "burst" (buildTranscript groups
// consecutive same-sender messages whose createdAt gap is small).
const MULTISEND_STAGGER_MS = 1;

/**
 * A sidekick reply may be several texts separated by newlines (the persona's
 * multi-send trait). Render each as its own bubble so it reads like a person
 * firing off a couple messages; buildTranscript's grouping gives the burst look
 * (2px stacking, one tail) for free. Non-text, attachment-bearing, or
 * single-line messages pass through unchanged so ids/reactions stay stable.
 */
function splitBurst(message: Message): Message[] {
  if (
    message.role !== "them" ||
    message.kind !== "text" ||
    message.images.length > 0 ||
    message.file !== undefined ||
    message.audio !== undefined
  ) {
    return [message];
  }
  const parts = message.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (parts.length <= 1) {
    return [message];
  }
  const last = parts.length - 1;
  return parts.map((text, k) => ({
    ...message,
    id: `${message.id}.${k}`,
    text,
    createdAt: message.createdAt + k * MULTISEND_STAGGER_MS,
    // the reply is one logical unit: keep the reply-target on the first bubble
    // and any reactions on the last, matching where a re-fetch will place them.
    replyToId: k === 0 ? message.replyToId : undefined,
    reactions: k === last ? message.reactions : [],
  }));
}

export function mainConversation(): Promise<{ id: string }> {
  return trpc.chat.mainConversation.query();
}

/**
 * The transcript, oldest-first (the inverted list reverses it). Only the two
 * roles the UI can draw survive — tool and marker rows are chrome. Rows with no
 * text and no attachments are dropped too: that's a tapback-only or
 * device-tool-only assistant turn, which would otherwise render as an empty
 * bubble. Voice-note user rows (empty text + audio attachment) and game
 * turn-card rows (empty text + a joined `game` payload) survive.
 */
export async function fetchTranscript(
  conversationId: string,
  limit: number,
): Promise<{ messages: Message[]; composerAd: AdView | undefined }> {
  const rows = await trpc.chat.history.query({ conversationId, limit });
  const visibleRows = rows.filter(
    (row) =>
      (row.role === "user" || row.role === "assistant") &&
      row.adUnitId === null &&
      (row.content.trim().length > 0 || row.attachments.length > 0 || row.game !== null),
  );
  // Only a match's newest turn card renders full-size. The page is newest-first
  // and history pages never skip rows, so the first row seen per match here IS
  // that match's latest row — derived locally alongside the server's flag.
  const latestGameRow = new Map<string, number>();
  for (const row of visibleRows) {
    if (row.game && !latestGameRow.has(row.game.matchId)) {
      latestGameRow.set(row.game.matchId, row.id);
    }
  }
  return {
    messages: visibleRows
      .map((row) =>
        toMessage(row, row.game !== null && latestGameRow.get(row.game.matchId) === row.id),
      )
      .reverse()
      .flatMap(splitBurst),
    composerAd: activeComposerAd(rows),
  };
}

/**
 * Run one turn to completion: stream the reply, then service any device tools the
 * model called and stream the continuation into the same message. The server
 * persists both sides, so the caller revalidates the transcript afterwards.
 */
export async function runTurn(input: {
  conversationId: string;
  text: string;
  replyToId?: string;
  attachmentIds?: string[];
}): Promise<void> {
  const noop = (): void => {};
  let calls = await streamChatTurn(
    {
      conversationId: input.conversationId,
      text: input.text,
      attachmentIds: input.attachmentIds,
      // A burst bubble's id is "<baseId>.<n>"; reply targets the whole reply (its
      // base row), matching how reactions resolve — and the stream schema needs an int.
      replyToId: input.replyToId === undefined ? undefined : Number(input.replyToId.split(".")[0]),
    },
    noop,
  );
  let rounds = 0;
  while (calls.length > 0 && rounds < MAX_DEVICE_TOOL_ROUNDS) {
    await runDeviceToolCalls(input.conversationId, calls);
    calls = await streamChatContinuation(input.conversationId, noop);
    rounds += 1;
  }
}

/** Upload a recording, then send it as the turn's only content. */
export async function sendVoiceTurn(
  conversationId: string,
  audio: AudioAttachment,
): Promise<void> {
  const file = await fetch(audio.uri);
  const blob = await file.blob();
  const { attachmentId } = await uploadAttachment({
    kind: "audio",
    mime: blob.type === "" ? "audio/m4a" : blob.type,
    bytes: blob.size,
    uri: audio.uri,
    durationMs: Math.round(audio.durationSec * 1000),
    waveform: audio.waveform,
  });
  await runTurn({ conversationId, text: "", attachmentIds: [attachmentId] });
}

/** Toggle the user's tapback. Passing the type they already picked clears it. */
export function react(messageId: string, type: ReactionType | null): Promise<unknown> {
  return trpc.chat.react.mutate({ messageId: rowId(messageId), type });
}

/** "Undo Send" — the message leaves the transcript for good. */
export function deleteMessage(messageId: string): Promise<unknown> {
  return trpc.chat.deleteMessage.mutate({ messageId: rowId(messageId) });
}
