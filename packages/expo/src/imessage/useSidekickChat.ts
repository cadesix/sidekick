import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteMessage,
  fetchTranscript,
  mainConversation,
  react,
  runTurn,
  sendVoiceTurn,
  sidekickThread,
} from "./server";
import type { AudioAttachment, Message, Reaction, ReactionType, Thread } from "./types";
import type { PendingAttachment } from "./lib/attachments";
import type { AdView } from "~/lib/chat-thread";
import { useGameReveal } from "~/store/game-reveal";

const PAGE_LIMIT = 100;

let localId = 0;
function nextLocalId(): string {
  localId += 1;
  return `local_${localId}`;
}

/** Split-bubble ids are `${rowId}.${k}`; the base is the persisted row. */
function baseId(id: string): string {
  const dot = id.indexOf(".");
  return dot === -1 ? id : id.slice(0, dot);
}

// Sequential-reveal pacing for a multi-bubble ("burst") reply.
const REVEAL_READ_GAP = 220; // beat after a bubble before the typing dots return
function revealGap(text: string): number {
  return Math.min(1600, 400 + text.length * 16); // dots linger ~ how long that text takes to "type"
}

/** The trailing run of `them` bubbles that belong to the same reply (row). */
function trailingBurst(
  messages: Message[],
): { base: string; count: number; segments: string[] } | null {
  if (messages.length === 0) {
    return null;
  }
  const last = messages[messages.length - 1];
  if (last.role !== "them") {
    return null;
  }
  const base = baseId(last.id);
  let start = messages.length - 1;
  while (
    start - 1 >= 0 &&
    messages[start - 1].role === "them" &&
    baseId(messages[start - 1].id) === base
  ) {
    start -= 1;
  }
  const segments = messages.slice(start).map((message) => message.text);
  return { base, count: segments.length, segments };
}

/** Mirrors the server's toggle so a tapback lands under the thumb, not a round-trip later. */
function toggleReaction(reactions: Reaction[], type: ReactionType): Reaction[] {
  const mine = reactions.find((reaction) => reaction.from === "me");
  const others = reactions.filter((reaction) => reaction.from !== "me");
  if (mine && mine.type === type) {
    return others;
  }
  return [...others, { type, from: "me" }];
}

interface SendInput {
  text: string;
  replyToId?: string;
  audio?: AudioAttachment;
  /** Picked attachments, already uploaded + ingested (`status === "ready"`). */
  attachments?: PendingAttachment[];
}

function optimistic(conversationId: string, input: SendInput): Message {
  const attachments = input.attachments ?? [];
  const file = attachments.find((attachment) => attachment.kind === "file");
  return {
    id: nextLocalId(),
    threadId: conversationId,
    role: "me",
    text: input.audio ? "Audio Message" : input.text,
    createdAt: Date.now(),
    status: "sending",
    replyToId: input.replyToId,
    reactions: [],
    kind: input.audio ? "audio" : "text",
    audio: input.audio,
    images: attachments
      .filter((attachment) => attachment.kind === "image")
      .map((attachment) => ({
        uri: attachment.localUri,
        width: attachment.width,
        height: attachment.height,
      })),
    file: file
      ? { url: file.localUri, filename: file.filename, mime: file.mime, bytes: file.bytes }
      : undefined,
  };
}

export interface SidekickChat {
  thread: Thread | undefined;
  messages: Message[];
  composerAd: AdView | undefined;
  typing: boolean;
  send: (input: SendInput) => void;
  addReaction: (messageId: string, type: ReactionType) => void;
  removeMessage: (messageId: string) => void;
}

/**
 * The chat's data layer. The transcript is the server's — so the sidekick's
 * memory, check-ins and device tools all see it — while a just-sent message shows
 * instantly as an optimistic bubble until the turn settles and history revalidates.
 */
export function useSidekickChat(): SidekickChat {
  const queryClient = useQueryClient();
  const [outgoing, setOutgoing] = useState<Message[]>([]);

  // Sequential reveal of a multi-bubble reply: hold the burst's later bubbles and
  // step them in with typing dots between, like a person firing off texts.
  const [reveal, setReveal] = useState<{ total: number; shown: number } | null>(null);
  const [revealTyping, setRevealTyping] = useState(false);
  const revealedBase = useRef<string | null>(null);
  const pendingReveal = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    for (const timer of timers.current) {
      clearTimeout(timer);
    }
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const conversation = useQuery({
    queryKey: ["chat", "main"],
    queryFn: mainConversation,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const conversationId = conversation.data?.id;
  const transcriptKey = ["chat", "transcript", conversationId];

  const transcript = useQuery({
    queryKey: transcriptKey,
    queryFn: () => fetchTranscript(conversationId ?? "", PAGE_LIMIT),
    enabled: conversationId !== undefined,
  });

  function patchTranscript(update: (messages: Message[]) => Message[]): void {
    queryClient.setQueryData<Awaited<ReturnType<typeof fetchTranscript>>>(
      transcriptKey,
      (current) =>
        current === undefined ? current : { ...current, messages: update(current.messages) },
    );
  }

  const turn = useMutation({
    mutationFn: async (input: SendInput) => {
      if (conversationId === undefined) {
        return;
      }
      if (input.audio) {
        await sendVoiceTurn(conversationId, input.audio);
        return;
      }
      const attachmentIds = (input.attachments ?? [])
        .map((attachment) => attachment.attachmentId)
        .filter((id): id is string => id !== undefined);
      await runTurn({
        conversationId,
        text: input.text,
        replyToId: input.replyToId,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      });
    },
    onMutate: (input) => {
      if (conversationId === undefined) {
        return;
      }
      pendingReveal.current = true; // the reply this produces should reveal bubble-by-bubble
      setOutgoing((current) => [...current, optimistic(conversationId, input)]);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: transcriptKey });
      setOutgoing([]);
    },
  });

  const reaction = useMutation({
    mutationFn: (input: { messageId: string; type: ReactionType }) =>
      react(input.messageId, input.type),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: transcriptKey });
      patchTranscript((messages) => {
        // reactions live on the reply's LAST bubble (matching the re-fetch), so a
        // tapback on any bubble of a burst lands consistently.
        const base = baseId(input.messageId);
        let target = -1;
        messages.forEach((message, index) => {
          if (baseId(message.id) === base) {
            target = index;
          }
        });
        return messages.map((message, index) =>
          index === target
            ? { ...message, reactions: toggleReaction(message.reactions, input.type) }
            : message,
        );
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: transcriptKey }),
  });

  const removal = useMutation({
    mutationFn: (messageId: string) => deleteMessage(messageId),
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: transcriptKey });
      patchTranscript((messages) =>
        messages.filter((message) => baseId(message.id) !== baseId(messageId)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: transcriptKey }),
  });

  // While a just-played game turn is settling, the sidekick's reply rows stay
  // behind the typing indicator for a beat (see store/game-reveal.ts). Distinct
  // from the burst `reveal` above (multi-bubble texting) — both filter `messages`.
  const gameReveal = useGameReveal();
  const fetched = transcript.data?.messages;

  // When a fresh reply lands as a multi-bubble burst, step its bubbles in one at a
  // time with typing dots between. History (initial load) and proactive/non-live
  // replies show at once — only a reply produced by a live send animates.
  useEffect(() => {
    if (!fetched) {
      return;
    }
    const burst = trailingBurst(fetched);
    if (!burst) {
      return;
    }
    const prev = revealedBase.current;
    if (prev !== null && Number(burst.base) <= Number(prev)) {
      return; // already handled this reply
    }
    if (prev === null && !pendingReveal.current) {
      revealedBase.current = burst.base; // initial history load — don't animate
      return;
    }
    revealedBase.current = burst.base;
    const live = pendingReveal.current;
    pendingReveal.current = false;
    clearTimers();
    if (!live || burst.count <= 1) {
      setReveal(null);
      setRevealTyping(false);
      return;
    }
    setReveal({ total: burst.count, shown: 1 });
    setRevealTyping(false);
    let at = 0;
    for (let k = 2; k <= burst.count; k += 1) {
      at += REVEAL_READ_GAP;
      timers.current.push(setTimeout(() => setRevealTyping(true), at));
      at += revealGap(burst.segments[k - 1]);
      const step = k;
      timers.current.push(
        setTimeout(() => {
          setReveal((current) => (current ? { ...current, shown: step } : current));
          setRevealTyping(false);
        }, at),
      );
    }
    timers.current.push(setTimeout(() => setReveal(null), at + 50));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched]);

  /**
   * Stable identity: ChatScreen memoizes the transcript, the reply chain and the
   * FlatList data on this array, so rebuilding it every render would re-run all
   * three (and re-render every visible row) on any unrelated state change.
   *
   * While a burst is revealing, hold back its not-yet-shown trailing bubbles.
   */
  const messages = useMemo(() => {
    const base = fetched ?? [];
    // Two independent reveal systems, but they never target the same reply — a game
    // hold follows a game turn; a burst hold follows a text turn — so treat them as
    // mutually exclusive (don't slice a game-filtered list, which would drop the
    // wrong trailing rows). Game hold takes precedence.
    let visible = base;
    if (gameReveal.holding) {
      visible = base.filter((message) => message.role === "me" || gameReveal.knownIds.has(message.id));
    } else if (reveal) {
      // burst reveal: hold the not-yet-shown trailing bubbles of a multi-bubble reply.
      // Clamp to the CURRENT trailing burst so a stale/oversized reveal can never hide
      // non-burst messages (or empty the whole list).
      const burst = trailingBurst(base);
      const maxHide = burst ? burst.count - 1 : 0;
      const hide = Math.min(Math.max(0, reveal.total - reveal.shown), maxHide);
      if (hide > 0) {
        visible = base.slice(0, base.length - hide);
      }
    } else if (pendingReveal.current) {
      // burst just landed but the effect hasn't scheduled yet — pre-hide its later
      // bubbles this render so they never flash in before sequencing starts.
      const burst = trailingBurst(base);
      const prev = revealedBase.current;
      if (burst && burst.count > 1 && (prev === null || Number(burst.base) > Number(prev))) {
        visible = base.slice(0, base.length - (burst.count - 1));
      }
    }
    return [...visible, ...outgoing];
  }, [fetched, outgoing, reveal, gameReveal]);

  return {
    thread: conversationId === undefined ? undefined : sidekickThread(conversationId),
    messages,
    composerAd: turn.isPending ? undefined : transcript.data?.composerAd,
    typing: turn.isPending || revealTyping || gameReveal.holding,
    send: turn.mutate,
    addReaction: (messageId, type) => reaction.mutate({ messageId, type }),
    removeMessage: removal.mutate,
  };
}
