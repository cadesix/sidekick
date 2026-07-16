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

/** A persisted row → the bubble the transcript renders. */
function toMessage(row: HistoryRow): Message {
  const audio = toAudio(row);
  return {
    id: String(row.id),
    threadId: row.conversationId,
    role: row.role === "user" ? "me" : "them",
    text: row.content,
    createdAt: new Date(row.createdAt).getTime(),
    status: row.role === "user" ? "read" : undefined,
    replyToId: row.replyToId === null ? undefined : String(row.replyToId),
    reactions: row.reactions,
    kind: audio ? "audio" : "text",
    audio,
    images: toImages(row),
    file: toFile(row),
  };
}

export function mainConversation(): Promise<{ id: string }> {
  return trpc.chat.mainConversation.query();
}

/**
 * The transcript, oldest-first (the inverted list reverses it). Only the two
 * roles the UI can draw survive — tool and marker rows are chrome.
 */
export async function fetchTranscript(
  conversationId: string,
  limit: number,
): Promise<{ messages: Message[]; composerAd: AdView | undefined }> {
  const rows = await trpc.chat.history.query({ conversationId, limit });
  const visibleRows = rows.filter(
    (row) => (row.role === "user" || row.role === "assistant") && row.adUnitId === null,
  );
  return {
    messages: visibleRows.map(toMessage).reverse(),
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
      replyToId: input.replyToId === undefined ? undefined : Number(input.replyToId),
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
  return trpc.chat.react.mutate({ messageId: Number(messageId), type });
}

/** "Undo Send" — the message leaves the transcript for good. */
export function deleteMessage(messageId: string): Promise<unknown> {
  return trpc.chat.deleteMessage.mutate({ messageId: Number(messageId) });
}
