import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Check, ChevronLeft, Flame, Smartphone } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Cadence } from "@sidekick/shared";
import { BottomSheet } from "~/components/BottomSheet";
import { PrimaryButton } from "~/components/PrimaryButton";
import { Skeleton } from "~/components/Skeleton";
import { SolidShadow } from "~/components/SolidShadow";
import {
  type GoalDetail,
  adjustGoalCadence,
  completeGoal,
  fetchGoalDetail,
  fetchMe,
  pauseGoal,
} from "~/lib/api";
import { cadenceLabel } from "~/lib/cosmetics";
import { iconForSlug } from "~/lib/goals";
import { pastelFor } from "~/lib/tokens";

function weekdayShort(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${dateStr}T00:00:00`));
}

const OUTCOME_TEXT: Record<string, { text: string; className: string }> = {
  hit: { text: "done", className: "text-ink" },
  partial: { text: "partway", className: "text-ink" },
  missed: { text: "missed", className: "text-ink/55" },
  skipped: { text: "skipped", className: "text-ink/45" },
};

export default function GoalDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);

  const detail = useQuery<GoalDetail>({
    queryKey: ["goal", id],
    queryFn: () => fetchGoalDetail(id),
    enabled: Boolean(id),
  });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Number.POSITIVE_INFINITY });

  const afterChange = () => {
    queryClient.invalidateQueries({ queryKey: ["goal", id] });
    queryClient.invalidateQueries({ queryKey: ["goals"] });
  };
  const adjust = useMutation({
    mutationFn: (cadence: Cadence) => adjustGoalCadence(id, cadence),
    onSuccess: () => {
      setEditing(false);
      afterChange();
    },
  });
  const pause = useMutation({
    mutationFn: () => pauseGoal(id),
    onSuccess: () => {
      afterChange();
      router.back();
    },
  });
  const complete = useMutation({
    mutationFn: () => completeGoal(id),
    onSuccess: () => {
      afterChange();
      router.back();
    },
  });

  const float = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(withTiming(-10, { duration: 2000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [float]);
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: float.value }] }));

  const goal = detail.data;
  const sidekickName = me.data?.sidekickName ?? "your sidekick";

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center active:opacity-60"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={26} color="#111" strokeWidth={2.5} />
        </Pressable>
        <Text className="text-[20px] font-extrabold text-ink ml-1 flex-1" numberOfLines={1}>
          {goal?.goal.label ?? ""}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {detail.isPending || !goal ? (
          <View className="pt-4 gap-4">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-12 rounded-2xl" />
          </View>
        ) : (
          <View>
            <View className="items-center py-6">
              <Animated.View style={floatStyle}>
                {iconForSlug(goal.goal.slug) ? (
                  <Image source={iconForSlug(goal.goal.slug)!} className="w-24 h-24" resizeMode="contain" />
                ) : (
                  <View className="w-24 h-24 rounded-full bg-field" />
                )}
              </Animated.View>
            </View>

            <SolidShadow>
              <View style={{ backgroundColor: pastelFor(0) }} className="rounded-2xl p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-[16px] font-bold text-ink flex-1">
                    {goal.goal.weeklyChallenge
                      ? `this week: ${goal.actionItem?.label ?? "a small challenge"}`
                      : `${cadenceLabel(goal.actionItem?.cadence ?? null)} · ${goal.actionItem?.label ?? ""}`}
                  </Text>
                  {goal.goal.weeklyChallenge ? null : (
                    <Pressable onPress={() => setEditing((v) => !v)} className="active:opacity-60">
                      <Text className="text-[14px] font-bold text-ink/45">
                        {editing ? "close" : "edit"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {editing ? (
                  <View className="flex-row flex-wrap gap-2 mt-3">
                    {goal.cadenceOptions.map((option, i) => (
                      <Pressable
                        key={i}
                        onPress={() => adjust.mutate(option)}
                        className="rounded-full bg-white border-2 border-ink px-3 py-1.5 active:opacity-70"
                      >
                        <Text className="text-[13px] font-bold text-ink">{cadenceLabel(option)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </SolidShadow>

            <View className="flex-row items-center gap-1.5 mt-4">
              <Flame size={18} color="#FF9F43" strokeWidth={2.5} />
              <Text className="text-[15px] font-bold text-ink">{goal.streak} day streak</Text>
            </View>

            <View className="h-px bg-ink/10 my-5" />
            <Text className="text-[16px] font-extrabold text-ink mb-3">This week</Text>
            <View className="flex-row justify-between">
              {goal.week.map((day) => (
                <WeekDot key={day.date} day={day} />
              ))}
            </View>

            <View className="h-px bg-ink/10 my-5" />
            <Text className="text-[16px] font-extrabold text-ink mb-3">Recent</Text>
            {goal.history.length === 0 ? (
              <Text className="text-[15px] leading-[1.6] text-ink/55">
                no history yet — talk to {sidekickName} and it'll show up here
              </Text>
            ) : (
              <View className="gap-2">
                {goal.history.map((row, i) => (
                  <HistoryRow key={i} row={row} />
                ))}
              </View>
            )}

            <View className="mt-8 gap-3 items-center">
              <Pressable onPress={() => setConfirmPause(true)} className="py-2 active:opacity-60">
                <Text className="text-[15px] font-semibold text-ink/55">Pause this goal</Text>
              </Pressable>
              <Pressable onPress={() => complete.mutate()} className="py-1 active:opacity-60">
                <Text className="text-[14px] font-semibold text-ink/40">Mark complete</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={confirmPause} onClose={() => setConfirmPause(false)}>
        <Text className="text-[18px] font-extrabold text-ink mb-1">
          pause {goal?.goal.label ?? "this goal"}?
        </Text>
        <Text className="text-[15px] leading-[1.6] text-ink/55 mb-5">your streak is saved.</Text>
        <PrimaryButton label="Pause" onPress={() => pause.mutate()} loading={pause.isPending} />
      </BottomSheet>
    </View>
  );
}

function WeekDot({ day }: { day: GoalDetail["week"][number] }) {
  const hit = day.outcome === "hit" || day.outcome === "partial";
  const missed = day.outcome === "missed";
  return (
    <View className="items-center gap-1">
      <View
        className={`w-8 h-8 rounded-full items-center justify-center ${
          hit ? "bg-ink" : "border-2 border-ink/20"
        } ${day.isToday ? "border-2 border-sun" : ""}`}
      >
        {hit ? <Check size={15} color="#fff" strokeWidth={3.5} /> : null}
        {missed ? <View className="w-3 h-0.5 rounded-full bg-ink/30" /> : null}
      </View>
      <Text className="text-[11px] font-bold text-ink/45">{day.weekday}</Text>
    </View>
  );
}

function HistoryRow({ row }: { row: GoalDetail["history"][number] }) {
  const outcome = OUTCOME_TEXT[row.outcome] ?? { text: row.outcome, className: "text-ink/55" };
  return (
    <View className="flex-row items-start gap-3 py-1">
      <Text className="text-[15px] font-bold text-ink w-12">{weekdayShort(row.date)}</Text>
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className={`text-[15px] font-semibold ${outcome.className}`}>{outcome.text}</Text>
          {row.source === "device" ? <Smartphone size={13} color="rgba(17,17,17,0.4)" strokeWidth={2.5} /> : null}
        </View>
        {row.note ? <Text className="text-[15px] text-ink/55">{row.note}</Text> : null}
      </View>
    </View>
  );
}
