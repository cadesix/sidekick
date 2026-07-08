import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check, ChevronLeft, Lock } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "~/components/BottomSheet";
import { PrimaryButton } from "~/components/PrimaryButton";
import { Skeleton } from "~/components/Skeleton";
import { SolidShadow } from "~/components/SolidShadow";
import { ChatSheet } from "~/features/chat/ChatSheet";
import {
  type DeepTalkCard,
  type DeepTalkShelf,
  type ImportCandidate,
  commitChatgptImport,
  fetchDeepTalkShelf,
  fetchMe,
  finishDeepTalk,
  stageChatgptImport,
  startDeepTalk,
} from "~/lib/api";
import { pastelFor } from "~/lib/tokens";

function ScoreBar({ percent }: { percent: number }) {
  const fill = useAnimatedStyle(
    () => ({
      width: withTiming(`${Math.max(0, Math.min(100, percent))}%`, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      }),
    }),
    [percent],
  );
  return (
    <View className="h-3 rounded-full bg-field overflow-hidden">
      <Animated.View style={fill} className="h-full rounded-full bg-sky" />
    </View>
  );
}

function ScoreCard({ shelf, sidekickName }: { shelf: DeepTalkShelf; sidekickName: string }) {
  return (
    <SolidShadow radius={20} className="bg-white">
      <View className="p-5">
        <View className="flex-row items-center gap-3">
          <View className="w-12 h-12 rounded-full bg-sun items-center justify-center">
            <Text style={{ fontSize: 26 }}>🐣</Text>
          </View>
          <View className="flex-1">
            <Text className="text-[13px] font-semibold text-ink/50">{sidekickName} knows you</Text>
            <Text className="text-[27px] font-extrabold tracking-[-0.02em] text-ink">
              {shelf.score}%
            </Text>
          </View>
        </View>
        <View className="mt-4">
          <ScoreBar percent={shelf.score} />
        </View>
        <Text className="mt-3 text-[14px] leading-[1.5] text-ink/60">{shelf.band.line}</Text>
      </View>
    </SolidShadow>
  );
}

function DeepTalkCardView({
  card,
  index,
  onPress,
}: {
  card: DeepTalkCard;
  index: number;
  onPress: () => void;
}) {
  const locked = !card.unlocked;
  return (
    <SolidShadow radius={18} onPress={locked ? undefined : onPress} disabled={locked}>
      <View
        style={{ width: 150, height: 130, backgroundColor: pastelFor(index), opacity: locked ? 0.4 : 1 }}
        className="rounded-[18px] p-3.5 justify-between"
      >
        <View className="flex-row items-start justify-between">
          <Text style={{ fontSize: 28 }}>{card.emoji}</Text>
          {locked ? <Lock size={16} color="#111" strokeWidth={2.5} /> : null}
          {card.completed ? <Check size={18} color="#111" strokeWidth={3} /> : null}
        </View>
        <View>
          <Text className="text-[15px] font-bold text-ink" numberOfLines={1}>
            {card.title}
          </Text>
          <Text className="text-[11px] leading-[1.35] text-ink/60 mt-0.5" numberOfLines={2}>
            {locked ? `knows you ${card.unlockAtScore}% to unlock` : card.teaser}
          </Text>
        </View>
      </View>
    </SolidShadow>
  );
}

function DeepTalkShelfView({
  shelf,
  onStart,
}: {
  shelf: DeepTalkShelf;
  onStart: (slug: string) => void;
}) {
  return (
    <View className="mt-7">
      <Text className="text-[13px] font-bold text-ink/45 mb-3 px-1">Deep talks</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 4, paddingVertical: 4 }}
      >
        {shelf.talks.map((card, index) => (
          <DeepTalkCardView
            key={card.slug}
            card={card}
            index={index}
            onPress={() => onStart(card.slug)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const IMPORT_STEPS = [
  "open ChatGPT",
  'ask it: "list everything you remember about me from memory, verbatim"',
  "copy the whole answer and paste it below",
];

function InstructionStep({ n, text }: { n: number; text: string }) {
  return (
    <View className="flex-row gap-3 mb-2.5">
      <View className="w-6 h-6 rounded-full bg-ink items-center justify-center mt-0.5">
        <Text className="text-white text-[13px] font-bold">{n}</Text>
      </View>
      <Text className="flex-1 text-[14px] leading-[1.45] text-ink/70">{text}</Text>
    </View>
  );
}

function CandidateRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ImportCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable onPress={onToggle} className="flex-row items-center gap-3 py-2.5 active:opacity-60">
      <View
        className={`w-6 h-6 rounded-full items-center justify-center border-2 ${
          checked ? "bg-ink border-ink" : "border-ink/25"
        }`}
      >
        {checked ? <Check size={15} color="#fff" strokeWidth={3} /> : null}
      </View>
      <Text className="flex-1 text-[14px] leading-[1.4] text-ink">{candidate.content}</Text>
    </Pressable>
  );
}

type ImportStage =
  | { step: "paste" }
  | { step: "review"; candidates: ImportCandidate[]; checked: boolean[] };

function ImportSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [stage, setStage] = useState<ImportStage>({ step: "paste" });

  const stageMutation = useMutation({
    mutationFn: (value: string) => stageChatgptImport(value),
    onSuccess: (candidates) =>
      setStage({ step: "review", candidates, checked: candidates.map(() => true) }),
  });
  const commitMutation = useMutation({
    mutationFn: (candidates: ImportCandidate[]) => commitChatgptImport(candidates),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    },
  });

  const toggle = (index: number) => {
    if (stage.step !== "review") {
      return;
    }
    setStage({
      ...stage,
      checked: stage.checked.map((value, i) => (i === index ? !value : value)),
    });
  };

  if (stage.step === "review") {
    const chosen = stage.candidates.filter((_, i) => stage.checked[i]);
    return (
      <BottomSheet visible onClose={onClose}>
        <Text className="text-[18px] font-extrabold text-ink mb-1">Review what to keep</Text>
        <Text className="text-[13px] leading-[1.5] text-ink/55 mb-3">
          These are memories like any other — editable and deletable here anytime.
        </Text>
        {stage.candidates.length === 0 ? (
          <Text className="text-[14px] text-ink/55 py-4">
            nothing new to add — looks like i already know this stuff.
          </Text>
        ) : (
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {stage.candidates.map((candidate, index) => (
              <CandidateRow
                key={index}
                candidate={candidate}
                checked={stage.checked[index] ?? false}
                onToggle={() => toggle(index)}
              />
            ))}
          </ScrollView>
        )}
        <View className="mt-4">
          <PrimaryButton
            label={chosen.length > 0 ? `add these ${chosen.length}` : "done"}
            loading={commitMutation.isPending}
            onPress={() => (chosen.length > 0 ? commitMutation.mutate(chosen) : onClose())}
          />
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible onClose={onClose}>
      <Text className="text-[18px] font-extrabold text-ink mb-3">Import from ChatGPT</Text>
      {IMPORT_STEPS.map((step, i) => (
        <InstructionStep key={i} n={i + 1} text={step} />
      ))}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="paste what ChatGPT remembers about you…"
        placeholderTextColor="rgba(17,17,17,0.35)"
        className="bg-field rounded-2xl px-4 py-3.5 text-[15px] text-ink mt-2 min-h-[120px]"
        multiline
        textAlignVertical="top"
      />
      <View className="mt-4">
        <PrimaryButton
          label="let it read it"
          loading={stageMutation.isPending}
          disabled={text.trim().length === 0}
          onPress={() => stageMutation.mutate(text.trim())}
        />
      </View>
    </BottomSheet>
  );
}

function ImportRow({ onPress }: { onPress: () => void }) {
  return (
    <View className="mt-7">
      <SolidShadow radius={16} onPress={onPress} className="bg-white">
        <View className="flex-row items-center gap-3 p-4">
          <Text style={{ fontSize: 24 }}>💬</Text>
          <View className="flex-1">
            <Text className="text-[15px] font-bold text-ink">Import from ChatGPT</Text>
            <Text className="text-[12px] leading-[1.4] text-ink/55 mt-0.5">
              Bring over what it already knows about you.
            </Text>
          </View>
        </View>
      </SolidShadow>
    </View>
  );
}

export default function Knows() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Number.POSITIVE_INFINITY });
  const shelf = useQuery<DeepTalkShelf>({ queryKey: ["deep-talks"], queryFn: fetchDeepTalkShelf });
  const [chatOpen, setChatOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);

  const sidekickName = me.data?.sidekickName ?? "your sidekick";

  const startMutation = useMutation({
    mutationFn: (slug: string) => startDeepTalk(slug),
    onSuccess: (result) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActiveConversation(result.conversationId);
      setChatOpen(true);
    },
  });

  const refresh = useMemo(
    () => () => {
      queryClient.invalidateQueries({ queryKey: ["deep-talks"] });
      queryClient.invalidateQueries({ queryKey: ["memory"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    [queryClient],
  );

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={() => router.back()}
          className="w-11 h-11 items-center justify-center active:opacity-60"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={26} color="#111" strokeWidth={2.5} />
        </Pressable>
        <Text className="text-[20px] font-extrabold text-ink ml-1">What {sidekickName} knows</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {shelf.isPending || !shelf.data ? (
          <View className="gap-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </View>
        ) : (
          <>
            <ScoreCard shelf={shelf.data} sidekickName={sidekickName} />
            <DeepTalkShelfView shelf={shelf.data} onStart={(slug) => startMutation.mutate(slug)} />
            <ImportRow onPress={() => setImportOpen(true)} />
          </>
        )}
      </ScrollView>

      {chatOpen ? (
        <ChatSheet
          onClose={async () => {
            setChatOpen(false);
            const conversationId = activeConversation;
            setActiveConversation(null);
            if (conversationId) {
              // Settle the session on close so the payoff (new memories, score,
              // reward) lands right away rather than waiting for the idle sweep.
              await finishDeepTalk(conversationId).catch(() => {});
            }
            refresh();
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportSheet
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            refresh();
          }}
        />
      ) : null}
    </View>
  );
}
