import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight, FileText, Settings as SettingsIcon, Sparkles } from "lucide-react-native";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { COSMETIC_CATALOG, type FocusChipState, focusChipState, isFocusGoalSlug } from "@sidekick/shared";
import { GoalRow } from "~/components/GoalRow";
import { PrimaryButton } from "~/components/PrimaryButton";
import { RewardSpinner } from "~/components/RewardSpinner";
import { Skeleton } from "~/components/Skeleton";
import { StreakPill } from "~/components/StreakPill";
import { ChatSheet } from "~/features/chat/ChatSheet";
import {
  type HomeSummary,
  fetchDeepTalkShelf,
  fetchDocumentCount,
  fetchHome,
  fetchInventory,
  fetchMe,
  fetchRewardStatus,
  getFocusSettings,
} from "~/lib/api";
import { greetingFor, todayLabel } from "~/lib/date";
import { focusBlocked } from "~/lib/focus";
import { iconForSlug, labelForSlug } from "~/lib/goals";
import { useChatDeepLink } from "~/lib/notifications";

const BACKDROP = require("../assets/home-backdrop.webp");
const CHAT_TAB = require("../assets/chat-tab.webp");

/** Where each equipped slot's glyph sits over the backdrop mascot, as fractions of screen height. */
const HOME_SLOT: Record<string, { top: number; nudgeX: number; size: number }> = {
  head: { top: 0.185, nudgeX: 0, size: 34 },
  face: { top: 0.25, nudgeX: 0, size: 24 },
  outfit: { top: 0.325, nudgeX: 0, size: 30 },
  accessory: { top: 0.305, nudgeX: 46, size: 28 },
};

/** Renders the user's equipped cosmetics over the home mascot (04 / 07 §1). */
function MascotCosmetics({ equipped }: { equipped: { slot: string; glyph: string }[] }) {
  return (
    <View pointerEvents="none" className="absolute inset-0">
      {equipped.map((item) => {
        const place = HOME_SLOT[item.slot];
        if (!place) {
          return null;
        }
        return (
          <View
            key={item.slot}
            className="absolute inset-x-0 items-center"
            style={{ top: `${place.top * 100}%` }}
          >
            <Text style={{ fontSize: place.size, transform: [{ translateX: place.nudgeX }] }}>
              {item.glyph}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function GoalsList({
  home,
  shieldFor,
}: {
  home: ReturnType<typeof useHome>;
  shieldFor: (slug: string) => FocusChipState;
}) {
  if (home.isPending) {
    return (
      <View className="gap-2.5">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </View>
    );
  }

  if (home.data && home.data.goals.length === 0) {
    return (
      <View className="gap-4 pt-2">
        <Text className="text-[15px] leading-[1.6] text-ink/55">no goals yet — let's pick one</Text>
        <PrimaryButton label="Add a goal" onPress={() => router.push("/add-goal")} />
      </View>
    );
  }

  return (
    <View className="gap-2.5">
      {(home.data?.goals ?? []).map((goal, index) => (
        <GoalRow
          key={goal.id}
          label={labelForSlug(goal.slug, goal.label)}
          icon={iconForSlug(goal.slug)}
          index={index}
          streak={goal.count}
          doneToday={goal.doneToday}
          shield={shieldFor(goal.slug)}
          onPress={() => router.push(`/goal/${goal.id}`)}
        />
      ))}
    </View>
  );
}

/** Doorway to the "what my sidekick knows" screen with a live context-score peek (14). */
function KnowsRow() {
  const shelf = useQuery({ queryKey: ["deep-talks"], queryFn: fetchDeepTalkShelf });
  const score = shelf.data?.score ?? 0;
  return (
    <View className="mt-6">
      <Text className="text-[13px] font-bold text-ink/45 mb-2">Get closer</Text>
      <Pressable
        onPress={() => router.push("/knows")}
        className="flex-row items-center gap-3 rounded-2xl bg-field pl-3 pr-4 py-3.5 active:opacity-70"
      >
        <Sparkles size={22} color="#111" strokeWidth={2.5} />
        <View className="flex-1">
          <Text className="text-[16px] font-bold text-ink">How well I know you</Text>
          <Text className="text-[12px] font-semibold text-ink/50 mt-0.5">{score}% · deep talks</Text>
        </View>
        <ChevronRight size={20} color="rgba(17,17,17,0.3)" strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

/** "Made for you" — a doorway to the sidekick's documents, hidden until there's one (07 / 15). */
function MadeForYouRow() {
  const documents = useQuery({ queryKey: ["documents", "count"], queryFn: fetchDocumentCount });
  if ((documents.data ?? 0) < 1) {
    return null;
  }
  return (
    <View className="mt-6">
      <Text className="text-[13px] font-bold text-ink/45 mb-2">Made for you</Text>
      <Pressable
        onPress={() => router.push("/documents")}
        className="flex-row items-center gap-3 rounded-2xl bg-field pl-3 pr-4 py-3.5 active:opacity-70"
      >
        <FileText size={22} color="#111" strokeWidth={2.5} />
        <Text className="flex-1 text-[16px] font-bold text-ink">Documents</Text>
        <ChevronRight size={20} color="rgba(17,17,17,0.3)" strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

function useHome() {
  return useQuery<HomeSummary>({ queryKey: ["goals"], queryFn: fetchHome });
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const now = new Date();
  const [chatOpen, setChatOpen] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Number.POSITIVE_INFINITY });
  const home = useHome();
  const inventory = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const rewardStatus = useQuery({ queryKey: ["reward-status"], queryFn: fetchRewardStatus });
  const focus = useQuery({ queryKey: ["focus"], queryFn: getFocusSettings });
  const focusIsBlocked = useQuery({ queryKey: ["focus-blocked"], queryFn: async () => focusBlocked() });
  const queryClient = useQueryClient();
  const [spinnerDismissed, setSpinnerDismissed] = useState(false);
  const goalsCount = home.data?.goals.length ?? 0;
  useChatDeepLink(() => setChatOpen(true));

  const equippedGlyphs = (inventory.data?.items ?? [])
    .filter((cosmetic) => cosmetic.equipped)
    .map((cosmetic) => ({
      slot: cosmetic.slot,
      glyph: COSMETIC_CATALOG.find((c) => c.key === cosmetic.itemKey)?.glyph ?? "",
    }))
    .filter((cosmetic) => cosmetic.glyph.length > 0);

  const spinnerCheckInId =
    rewardStatus.data?.status === "available" ? rewardStatus.data.checkInId : null;

  const focusEnabled = focus.data?.enabled ?? false;
  const focusBlockedNow = focusIsBlocked.data ?? false;
  function shieldFor(slug: string): FocusChipState {
    if (!isFocusGoalSlug(slug)) {
      return null;
    }
    return focusChipState({ enabled: focusEnabled, blocked: focusBlockedNow });
  }

  function closeSpinner() {
    setSpinnerDismissed(true);
    queryClient.invalidateQueries({ queryKey: ["reward-status"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["goals"] });
  }

  const chromeStyle = useAnimatedStyle(
    () => ({ opacity: withTiming(chatOpen ? 0 : 1, { duration: 300 }) }),
    [chatOpen],
  );

  if (me.isPending) {
    return <View className="flex-1 bg-white" />;
  }
  if (!me.data?.onboardingComplete) {
    return <Redirect href="/onboarding" />;
  }

  const checkInAvailable = home.data?.checkInAvailable ?? false;
  const sidekickName = me.data.sidekickName ?? "your sidekick";

  return (
    <View className="flex-1 bg-white">
      <Image source={BACKDROP} className="absolute inset-0 w-full h-full" resizeMode="cover" />
      <LinearGradient
        colors={["rgba(0,0,0,0.35)", "transparent"]}
        className="absolute inset-x-0 top-0 h-44"
      />

      <Animated.View style={chromeStyle} pointerEvents="none">
        <MascotCosmetics equipped={equippedGlyphs} />
      </Animated.View>

      <Animated.View style={chromeStyle} className="px-5" pointerEvents={chatOpen ? "none" : "auto"}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-[13px] font-semibold text-white/85">{todayLabel(now)}</Text>
            <Text className="mt-0.5 text-[28px] font-extrabold tracking-[-0.02em] text-white">
              {greetingFor(now)}
            </Text>
            {checkInAvailable ? (
              <Text className="mt-1 text-[14px] font-semibold text-white/90">
                {sidekickName} has something to say 👀
              </Text>
            ) : null}
          </View>
          <View className="items-end gap-2">
            <StreakPill count={home.data?.streak ?? 0} onPhoto />
            <Pressable
              onPress={() => router.push("/settings")}
              className="w-9 h-9 rounded-full bg-white/90 items-center justify-center active:opacity-80"
              accessibilityLabel="Settings"
            >
              <SettingsIcon size={18} color="#111" strokeWidth={2.5} />
            </Pressable>
          </View>
        </View>
      </Animated.View>

      <Animated.View
        style={chromeStyle}
        pointerEvents={chatOpen ? "none" : "auto"}
        className="absolute inset-x-0 bottom-0 top-[46%] bg-white rounded-t-[32px]"
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-ink/12" />
        </View>
        <View className="px-5 pt-2 flex-row items-baseline justify-between">
          <Text className="text-[18px] font-extrabold text-ink">Your goals</Text>
          <Text className="text-[13px] font-bold text-ink/45">{goalsCount}</Text>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 96 }}
          showsVerticalScrollIndicator={false}
        >
          <GoalsList home={home} shieldFor={shieldFor} />
          <KnowsRow />
          <MadeForYouRow />
        </ScrollView>
      </Animated.View>

      <Animated.View style={chromeStyle} pointerEvents={chatOpen ? "none" : "auto"}>
        <View className="absolute z-30" style={{ bottom: 24 + insets.bottom, right: 20, width: 68, height: 68 }}>
          <View className="absolute rounded-full bg-black/15" style={{ left: 0, right: 0, top: 5, bottom: -5 }} />
          <Pressable
            onPress={() => setChatOpen(true)}
            className="w-[68px] h-[68px] rounded-full bg-white items-center justify-center active:translate-y-[2px]"
            accessibilityLabel="Talk to your sidekick"
          >
            <Image source={CHAT_TAB} className="w-14 h-14" resizeMode="contain" />
          </Pressable>
          {checkInAvailable ? (
            <View className="absolute top-0 right-0 w-4 h-4 rounded-full bg-sun border-2 border-white" />
          ) : null}
        </View>
      </Animated.View>

      {chatOpen ? <ChatSheet onClose={() => setChatOpen(false)} /> : null}

      {spinnerCheckInId && !spinnerDismissed ? (
        <RewardSpinner checkInId={spinnerCheckInId} onClose={closeSpinner} />
      ) : null}
    </View>
  );
}
