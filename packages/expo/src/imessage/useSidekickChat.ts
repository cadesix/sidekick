import { useMemo, useState } from "react";
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
import type { AdView } from "~/lib/chat-thread";

const PAGE_LIMIT = 100;

let localId = 0;
function nextLocalId(): string {
  localId += 1;
  return `local_${localId}`;
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
}

function optimistic(conversationId: string, input: SendInput): Message {
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
    queryClient.setQueryData<Message[]>(transcriptKey, (current) => update(current ?? []));
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
      await runTurn({ conversationId, text: input.text, replyToId: input.replyToId });
    },
    onMutate: (input) => {
      if (conversationId === undefined) {
        return;
      }
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
      patchTranscript((messages) =>
        messages.map((message) =>
          message.id === input.messageId
            ? { ...message, reactions: toggleReaction(message.reactions, input.type) }
            : message,
        ),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: transcriptKey }),
  });

  const removal = useMutation({
    mutationFn: (messageId: string) => deleteMessage(messageId),
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: transcriptKey });
      patchTranscript((messages) => messages.filter((message) => message.id !== messageId));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: transcriptKey }),
  });

  const fetched = transcript.data?.messages;
  /**
   * Stable identity: ChatScreen memoizes the transcript, the reply chain and the
   * FlatList data on this array, so rebuilding it every render would re-run all
   * three (and re-render every visible row) on any unrelated state change.
   */
  const messages = useMemo(() => [...(fetched ?? []), ...outgoing], [fetched, outgoing]);

  return {
    thread: conversationId === undefined ? undefined : sidekickThread(conversationId),
    messages,
    composerAd: turn.isPending ? undefined : transcript.data?.composerAd,
    typing: turn.isPending,
    send: turn.mutate,
    addReaction: (messageId, type) => reaction.mutate({ messageId, type }),
    removeMessage: removal.mutate,
  };
}
