import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StreamMeta } from "@sidekick/shared";
import {
  chatHistory,
  historyAround,
  mainConversationId,
  streamChatContinuation,
  streamChatTurn,
} from "~/lib/api";
import { runDeviceToolCalls } from "./device-tools";
import {
  type AdView,
  buildChatRows,
  getNextCursor,
  type MessageAttachment,
  mergeHistoryPages,
} from "~/lib/chat-thread";
import { localDayKey } from "~/lib/date";

const PAGE_LIMIT = 50;
const AROUND_SPAN = 25;

/**
 * Safety ceiling on device-tool ↔ continuation rounds within one send (12). A real
 * turn resolves in one round; this bounds a model that keeps calling device tools.
 */
const MAX_DEVICE_TOOL_ROUNDS = 4;

type PendingTurn = {
  userText: string;
  assistantText: string;
  status: "streaming" | "error";
  /** True while a web search is streaming (11) — drives the "looking it up…" caption. */
  searching: boolean;
};

/**
 * A row the chat FlatList renders. Newest-first (row 0 is the visual bottom of the
 * inverted list).
 */
export type RenderRow =
  | { kind: "separator"; key: string; label: string; date: string }
  | {
      kind: "message";
      key: string;
      role: "user" | "assistant";
      text: string;
      messageId: number;
      highlight: boolean;
      attachments: MessageAttachment[];
      toolCalls: unknown;
      ad: AdView | null;
    }
  | { kind: "live"; key: string; role: "user" | "assistant"; text: string }
  | { kind: "typing"; key: string; searching: boolean }
  | { kind: "error"; key: string };

export function useChat() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [replyOptions, setReplyOptions] = useState<string[]>([]);

  const conversation = useQuery({
    queryKey: ["chat", "conversation"],
    queryFn: mainConversationId,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const conversationId = conversation.data?.id ?? null;

  const history = useInfiniteQuery({
    queryKey: ["chat", "history", conversationId],
    enabled: conversationId !== null && focusId === null,
    queryFn: ({ pageParam }) => chatHistory(conversationId ?? "", pageParam, PAGE_LIMIT),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => getNextCursor(lastPage, PAGE_LIMIT),
  });

  const around = useQuery({
    queryKey: ["chat", "around", conversationId, focusId],
    enabled: conversationId !== null && focusId !== null,
    queryFn: () => historyAround(conversationId ?? "", focusId ?? 0, AROUND_SPAN),
  });

  const messages =
    focusId !== null
      ? around.data ?? []
      : history.data
        ? mergeHistoryPages(history.data.pages)
        : [];

  const rows: RenderRow[] = [];

  if (focusId === null && pending) {
    if (pending.status === "error") {
      rows.push({ kind: "error", key: "live-error" });
    } else if (pending.assistantText.length === 0) {
      rows.push({ kind: "typing", key: "live-typing", searching: pending.searching });
    } else {
      rows.push({ kind: "live", key: "live-assistant", role: "assistant", text: pending.assistantText });
    }
    if (pending.userText.length > 0) {
      rows.push({ kind: "live", key: "live-user", role: "user", text: pending.userText });
    }
  }

  for (const row of buildChatRows(messages, new Date())) {
    if (row.type === "separator") {
      rows.push({ kind: "separator", key: row.key, label: row.label, date: row.date });
    } else {
      rows.push({
        kind: "message",
        key: row.key,
        role: row.message.role === "user" ? "user" : "assistant",
        text: row.message.content,
        messageId: row.message.id,
        highlight: row.message.id === focusId,
        attachments: row.message.attachments ?? [],
        toolCalls: row.message.toolCalls,
        ad: row.message.ad ?? null,
      });
    }
  }

  async function runTurn(text: string, attachmentIds: string[]): Promise<void> {
    if (conversationId === null) {
      return;
    }
    setPending({ userText: text, assistantText: "", status: "streaming", searching: false });
    setReplyOptions([]);
    try {
      const onDelta = (delta: string) =>
        setPending((prev) => (prev ? { ...prev, assistantText: prev.assistantText + delta } : prev));
      const onSearch = (active: boolean) =>
        setPending((prev) => (prev ? { ...prev, searching: active } : prev));
      const onMeta = (meta: StreamMeta) => setReplyOptions(meta.replies);

      /**
       * Device-tool loop (12): the model can ask the app to run a native op
       * (read_health / focus_*). Each surfaced call runs on-device, its result
       * posts back, and the turn resumes streaming the follow-up into the SAME
       * assistant bubble — a single coherent turn. Bounded to avoid a runaway.
       */
      let calls = await streamChatTurn({ conversationId, text, attachmentIds }, onDelta, onSearch, onMeta);
      let rounds = 0;
      while (calls.length > 0 && rounds < MAX_DEVICE_TOOL_ROUNDS) {
        rounds += 1;
        await runDeviceToolCalls(conversationId, calls);
        calls = await streamChatContinuation(conversationId, onDelta, onSearch, onMeta);
      }
      await queryClient.invalidateQueries({ queryKey: ["chat", "history", conversationId] });
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      setPending(null);
    } catch {
      setPending((prev) => (prev ? { ...prev, status: "error" } : prev));
    }
  }

  function send(text: string, attachmentIds: string[] = []): void {
    const trimmed = text.trim();
    if (
      (trimmed.length === 0 && attachmentIds.length === 0) ||
      (pending !== null && pending.status === "streaming")
    ) {
      return;
    }
    void runTurn(trimmed, attachmentIds);
  }

  function retry(): void {
    if (pending !== null) {
      void runTurn(pending.userText, []);
    }
  }

  /** Jump to the first (oldest) loaded message of a local day (08 jump-to-date). */
  function jumpToDate(date: Date): void {
    const key = localDayKey(date);
    const ofDay = messages.filter((m) => localDayKey(new Date(m.createdAt)) === key);
    const first = ofDay[ofDay.length - 1];
    if (first) {
      setFocusId(first.id);
    }
  }

  return {
    rows,
    conversationId,
    /**
     * Reply chips (07 §2): the server's post-hoc suggested replies for the turn
     * that just streamed, cleared as soon as the next send starts.
     */
    replyOptions,
    send,
    retry,
    focusMessage: (id: number) => setFocusId(id),
    clearFocus: () => setFocusId(null),
    jumpToDate,
    centered: focusId !== null,
    isStreaming: pending !== null && pending.status === "streaming",
    loading: conversation.isPending || (focusId === null && history.isPending),
    loadOlder: () => {
      if (focusId === null && history.hasNextPage && !history.isFetchingNextPage) {
        void history.fetchNextPage();
      }
    },
  };
}
