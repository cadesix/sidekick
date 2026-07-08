import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useQuery } from "@tanstack/react-query";
import { SidekickBubble, TypingBubble, UserBubble } from "~/components/ChatBubbles";
import { PrimaryButton } from "~/components/PrimaryButton";
import { ReplyChips } from "~/components/ReplyChips";
import { SendButton } from "~/components/SendButton";
import { chatHistory, startOnboardingChat, streamChatTurn } from "~/lib/api";
import { registerForPushToken } from "~/lib/notifications";
import type { GoalChoicePatch } from "../plan";
import { buildGoalBeats, introLines } from "../plan";

export type OnboardingChatResult = {
  patches: GoalChoicePatch[];
  /** Null when the LLM chat stored the time server-side via `set_reminder_time`. */
  reminderTime: string | null;
  pushToken: string | null;
};

type ChatStepProps = {
  goalSlugs: string[];
  sidekickName: string;
  finishing: boolean;
  onFinish: (result: OnboardingChatResult) => void;
};

/**
 * The onboarding chat step (02 §onboarding chat). The real thing is the
 * LLM-driven guided chat on a `kind='onboarding'` conversation; the scripted
 * quick-reply flow below is the skeleton it falls back to when the server can't
 * start one (offline, error), so the funnel never dead-ends.
 */
export function OnboardingChatStep(props: ChatStepProps) {
  const start = useQuery({
    queryKey: ["onboarding", "chat"],
    queryFn: () => startOnboardingChat(props.goalSlugs),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });

  if (start.isPending) {
    return (
      <View className="flex-1 bg-white px-4 pt-4">
        <TypingBubble />
      </View>
    );
  }
  if (start.isError) {
    return <ScriptedOnboardingChat {...props} />;
  }
  return <LlmOnboardingChat conversationId={start.data.conversationId} {...props} />;
}

type ChatMsg = { role: "bot" | "user"; text: string };
type LiveTurn = { userText: string; assistantText: string; status: "streaming" | "error" };

const PUSH_OPTIONS = ["Turn on notifications", "Maybe later"];

/**
 * The LLM-driven chat: streams turns on the onboarding conversation, renders the
 * server's suggested replies as chips, and keys its push-permission UI off the
 * `wrap_up` beat in the stream's meta frame (soft prompt → OS dialog, 02 §push).
 * Free text is always allowed; the model maps it via `commit_onboarding_choice`.
 */
function LlmOnboardingChat({
  conversationId,
  finishing,
  onFinish,
}: ChatStepProps & { conversationId: string }) {
  const history = useQuery({
    queryKey: ["onboarding", "chat", "history", conversationId],
    queryFn: () => chatHistory(conversationId, undefined, 50),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [turns, setTurns] = useState<ChatMsg[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [replies, setReplies] = useState<string[]>([]);
  const [beat, setBeat] = useState<string | null>(null);
  const [pushAsked, setPushAsked] = useState(false);
  const [draft, setDraft] = useState("");
  const pushTokenRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const initial: ChatMsg[] = (history.data ?? [])
    .slice()
    .reverse()
    .filter((m) => m.role !== "tool" && m.content.trim().length > 0)
    .map((m): ChatMsg => ({ role: m.role === "user" ? "user" : "bot", text: m.content }));
  const messages = [...initial, ...turns];
  const streaming = live !== null && live.status === "streaming";

  async function runTurn(text: string): Promise<void> {
    setLive({ userText: text, assistantText: "", status: "streaming" });
    setReplies([]);
    try {
      await streamChatTurn(
        { conversationId, text },
        (delta) =>
          setLive((prev) => (prev ? { ...prev, assistantText: prev.assistantText + delta } : prev)),
        () => {},
        (meta) => {
          setReplies(meta.replies);
          setBeat(meta.beat ?? null);
        },
      );
      setLive((prev) => {
        if (prev) {
          setTurns((t) => [
            ...t,
            { role: "user", text: prev.userText },
            { role: "bot", text: prev.assistantText },
          ]);
        }
        return null;
      });
    } catch {
      setLive((prev) => (prev ? { ...prev, status: "error" } : prev));
    }
  }

  function send(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0 || streaming || finishing) {
      return;
    }
    setDraft("");
    void runTurn(trimmed);
  }

  async function pickPush(label: string): Promise<void> {
    setPushAsked(true);
    if (label === PUSH_OPTIONS[0]) {
      const { token } = await registerForPushToken();
      pushTokenRef.current = token;
    }
    send(label);
  }

  const finish = () =>
    onFinish({ patches: [], reminderTime: null, pushToken: pushTokenRef.current });

  const showPushChips = beat === "wrap_up" && !pushAsked && !streaming;
  const showFinish = beat === "wrap_up" && pushAsked && !streaming;
  const chipOptions = showPushChips ? PUSH_OPTIONS : replies;

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 12, gap: 12 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {history.isPending ? <TypingBubble /> : null}
        {messages.map((m, i) =>
          m.role === "bot" ? <SidekickBubble key={i} text={m.text} /> : <UserBubble key={i} text={m.text} />,
        )}
        {live !== null ? <UserBubble text={live.userText} /> : null}
        {live !== null && live.status === "streaming" ? (
          live.assistantText.length > 0 ? (
            <SidekickBubble text={live.assistantText} />
          ) : (
            <TypingBubble />
          )
        ) : null}
        {live !== null && live.status === "error" ? (
          <Pressable onPress={() => void runTurn(live.userText)} className="active:opacity-70">
            <SidekickBubble text="hmm, i glitched — tap to resend ↻" />
          </Pressable>
        ) : null}
      </ScrollView>

      {chipOptions.length > 0 && !streaming ? (
        <View className="px-4 pb-2">
          <ReplyChips
            options={chipOptions}
            onSelect={(text) => {
              if (showPushChips) {
                void pickPush(text);
              } else {
                send(text);
              }
            }}
          />
        </View>
      ) : null}

      <View className="px-4 pt-2 pb-7 border-t border-ink/10 gap-3">
        {showFinish ? <PrimaryButton label="Enter Sidekick" onPress={finish} loading={finishing} /> : null}
        <View className="flex-row items-end gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => send(draft)}
            placeholder="Message…"
            placeholderTextColor="rgba(17,17,17,0.4)"
            returnKeyType="send"
            className="flex-1 bg-field rounded-full px-4 py-2.5 text-[15px] text-ink"
          />
          <SendButton onPress={() => send(draft)} disabled={draft.trim().length === 0 || streaming} />
        </View>
      </View>
    </View>
  );
}

type ScriptedBeat =
  | { kind: "auto"; messages: string[] }
  | { kind: "chips"; messages: string[]; options: { label: string; patch?: GoalChoicePatch }[] }
  | { kind: "reminder"; messages: string[] }
  | { kind: "push"; messages: string[] }
  | { kind: "finish"; messages: string[] };

function buildBeats(goalSlugs: string[], sidekickName: string): ScriptedBeat[] {
  const goalBeats = buildGoalBeats(goalSlugs).map(
    (beat): ScriptedBeat => ({ kind: "chips", messages: beat.messages, options: beat.options }),
  );
  return [
    { kind: "auto", messages: introLines(sidekickName) },
    ...goalBeats,
    { kind: "reminder", messages: ["nice — that's a real plan now 💪", "when should i check in with you?"] },
    { kind: "push", messages: ["last thing — can i send you a nudge so you don't forget? 🔔"] },
    { kind: "finish", messages: ["amazing — your plan's all set 🙌", "let's gooo!"] },
  ];
}

function formatTime(date: Date): string {
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  return `${hh}:${mm}`;
}

function label12h(date: Date): string {
  const h = date.getHours();
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${`${date.getMinutes()}`.padStart(2, "0")} ${suffix}`;
}

/**
 * The scripted fallback — the ported web quick-reply flow. Fully client-side, so
 * it works even when the chat backend is unreachable; its structured result is
 * committed by the funnel via `onboarding.complete`.
 */
function ScriptedOnboardingChat({ goalSlugs, sidekickName, finishing, onFinish }: ChatStepProps) {
  const [beats] = useState(() => buildBeats(goalSlugs, sidekickName));
  const [beatIndex, setBeatIndex] = useState(1);
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    const built = buildBeats(goalSlugs, sidekickName);
    const opening = [...built[0].messages, ...(built[1]?.messages ?? [])];
    return opening.map((text): ChatMsg => ({ role: "bot", text }));
  });
  const [interactive, setInteractive] = useState(true);

  const patchesRef = useRef<GoalChoicePatch[]>([]);
  const reminderRef = useRef("09:00");
  const pushTokenRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [reminderDraft, setReminderDraft] = useState(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });

  const beat = beats[beatIndex];

  const advance = () => {
    const index = beatIndex + 1;
    const next = beats[index];
    if (!next) {
      return;
    }
    setBeatIndex(index);
    setMessages((prev) => [...prev, ...next.messages.map((text): ChatMsg => ({ role: "bot", text }))]);
    setInteractive(true);
  };

  const pickChip = (label: string, patch?: GoalChoicePatch) => {
    setInteractive(false);
    setMessages((prev) => [...prev, { role: "user", text: label }]);
    if (patch) {
      patchesRef.current = [...patchesRef.current, patch];
    }
    advance();
  };

  const setReminder = () => {
    setInteractive(false);
    reminderRef.current = formatTime(reminderDraft);
    setMessages((prev) => [...prev, { role: "user", text: label12h(reminderDraft) }]);
    advance();
  };

  const choosePush = async (enable: boolean) => {
    setInteractive(false);
    setMessages((prev) => [...prev, { role: "user", text: enable ? PUSH_OPTIONS[0] : PUSH_OPTIONS[1] }]);
    if (enable) {
      const { token } = await registerForPushToken();
      pushTokenRef.current = token;
    }
    advance();
  };

  const finish = () =>
    onFinish({
      patches: patchesRef.current,
      reminderTime: reminderRef.current,
      pushToken: pushTokenRef.current,
    });

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 12, gap: 12 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m, i) =>
          m.role === "bot" ? <SidekickBubble key={i} text={m.text} /> : <UserBubble key={i} text={m.text} />,
        )}
      </ScrollView>

      <View className="px-4 pt-3 pb-7 border-t border-ink/10">{renderControls()}</View>
    </View>
  );

  function renderControls() {
    if (!beat || !interactive) {
      return <View className="h-11" />;
    }
    if (beat.kind === "chips") {
      return (
        <ReplyChips
          options={beat.options.map((o) => o.label)}
          onSelect={(label) => pickChip(label, beat.options.find((o) => o.label === label)?.patch)}
        />
      );
    }
    if (beat.kind === "reminder") {
      return (
        <View className="gap-3">
          <View className="items-center">
            <DateTimePicker
              value={reminderDraft}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(_event: DateTimePickerEvent, date?: Date) => date && setReminderDraft(date)}
            />
          </View>
          <PrimaryButton label={`Check in at ${label12h(reminderDraft)}`} onPress={setReminder} />
        </View>
      );
    }
    if (beat.kind === "push") {
      return <ReplyChips options={PUSH_OPTIONS} onSelect={(label) => void choosePush(label === PUSH_OPTIONS[0])} />;
    }
    return <PrimaryButton label="Enter Sidekick" onPress={finish} loading={finishing} />;
  }
}
