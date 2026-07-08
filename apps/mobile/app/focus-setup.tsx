import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeviceActivitySelectionViewPersisted } from "react-native-device-activity";
import {
  BUDGET_CHOICES,
  budgetLabel,
  focusMirrorPatch,
  selectionCount,
  setupReady,
  shieldPreview,
} from "@sidekick/shared";
import { PrimaryButton } from "~/components/PrimaryButton";
import { SolidShadow } from "~/components/SolidShadow";
import { fetchMe, getFocusSettings, updateFocusSettings } from "~/lib/api";
import { disableFocus, focusAvailable, refreshShield, startDailyMonitor } from "~/lib/focus";

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-4 py-2.5 border-2 border-ink ${selected ? "bg-sun" : "bg-white"} active:opacity-70`}
    >
      <Text className="text-[15px] font-bold text-ink">{label}</Text>
    </Pressable>
  );
}

/** The static shield preview (13 §UI) — exactly the interruption they're signing up for. */
function ShieldPreview({
  sidekickName,
  budgetMinutes,
  streak,
}: {
  sidekickName: string;
  budgetMinutes: number | null;
  streak: number;
}) {
  const preview = shieldPreview({ date: new Date(), budgetMinutes, streak, sidekickName });
  return (
    <View className="rounded-2xl bg-ink px-5 py-6 mt-2">
      <View className="w-12 h-12 rounded-full bg-white/10 items-center justify-center mb-3">
        <Text className="text-[24px]">🌙</Text>
      </View>
      <Text className="text-[18px] font-extrabold text-white">{preview.title}</Text>
      <Text className="text-[14px] leading-[1.5] text-white/60 mt-1 mb-4">{preview.subtitle}</Text>
      <View className="rounded-full bg-sun py-2.5 items-center mb-2.5">
        <Text className="text-[14px] font-bold text-ink">{preview.primaryLabel}</Text>
      </View>
      <View className="rounded-full border border-white/30 py-2.5 items-center">
        <Text className="text-[14px] font-semibold text-white">{preview.secondaryLabel}</Text>
      </View>
    </View>
  );
}

export default function FocusSetup() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const available = focusAvailable();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Number.POSITIVE_INFINITY });
  const focus = useQuery({ queryKey: ["focus"], queryFn: getFocusSettings });

  const [budgetOverride, setBudgetOverride] = useState<number | null | undefined>(undefined);
  const [countOverride, setCountOverride] = useState<number | undefined>(undefined);
  const [customOpen, setCustomOpen] = useState(false);

  const budgetMinutes = budgetOverride === undefined ? (focus.data?.budgetMinutes ?? null) : budgetOverride;
  const count = countOverride ?? focus.data?.selectionCount ?? 0;
  const sidekickName = me.data?.sidekickName ?? "your sidekick";
  const enabled = focus.data?.enabled ?? false;
  const ready = setupReady({ selectionCount: count });
  const isCustomBudget =
    budgetMinutes !== null && !(BUDGET_CHOICES as readonly number[]).includes(budgetMinutes);

  const start = useMutation({
    mutationFn: async () => {
      if (budgetMinutes !== null) {
        await startDailyMonitor({ budgetMinutes, sidekickName });
      }
      refreshShield({
        date: new Date(),
        budgetMinutes,
        streak: 0,
        sidekickName,
      });
      await updateFocusSettings(focusMirrorPatch.startGuarding({ selectionCount: count, budgetMinutes }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["focus"] });
      queryClient.invalidateQueries({ queryKey: ["focus-blocked"] });
      router.back();
    },
  });

  const turnOff = useMutation({
    mutationFn: async () => {
      disableFocus();
      await updateFocusSettings(focusMirrorPatch.disable());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["focus"] });
      queryClient.invalidateQueries({ queryKey: ["focus-blocked"] });
      router.back();
    },
  });

  function chooseBudget(minutes: number | null): void {
    setCustomOpen(false);
    setBudgetOverride(minutes);
  }

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
        <Text className="text-[20px] font-extrabold text-ink ml-1">Focus</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-[27px] font-extrabold tracking-[-0.02em] leading-[1.15] text-ink">
          pick what i guard
        </Text>
        <Text className="text-[15px] leading-[1.6] text-ink/60 mt-1 mb-5">
          i can't see what you choose — apple only tells me time.
        </Text>

        {available ? (
          <SolidShadow>
            <View className="bg-white rounded-2xl overflow-hidden" style={{ minHeight: 320 }}>
              <DeviceActivitySelectionViewPersisted
                style={{ flex: 1, minHeight: 320 }}
                familyActivitySelectionId="focus"
                includeEntireCategory
                onSelectionChange={(event) => {
                  setCountOverride(selectionCount(event.nativeEvent));
                }}
              />
            </View>
          </SolidShadow>
        ) : (
          <SolidShadow>
            <View className="bg-white rounded-2xl px-5 py-8 items-center" style={{ minHeight: 160 }}>
              <Text className="text-[15px] leading-[1.6] text-ink/60 text-center">
                app blocking needs iOS 15.1+ and Apple's Family Controls — it isn't available on this
                build yet. your goal still works on the honor system in the meantime.
              </Text>
            </View>
          </SolidShadow>
        )}

        <Text className="text-[12px] font-medium text-ink/40 uppercase tracking-wide mt-7 mb-2.5">
          Daily budget
        </Text>
        <View className="flex-row flex-wrap gap-2.5">
          {BUDGET_CHOICES.map((minutes) => (
            <Chip
              key={minutes}
              label={budgetLabel(minutes)}
              selected={!isCustomBudget && budgetMinutes === minutes}
              onPress={() => chooseBudget(minutes)}
            />
          ))}
          <Chip
            label="custom"
            selected={isCustomBudget || customOpen}
            onPress={() => setCustomOpen(true)}
          />
        </View>

        {customOpen || isCustomBudget ? (
          <SolidShadow>
            <View className="flex-row items-center gap-2 bg-white rounded-2xl px-4 py-3 mt-2.5">
              <TextInput
                value={budgetMinutes === null ? "" : String(budgetMinutes)}
                onChangeText={(text) => {
                  const parsed = Number.parseInt(text, 10);
                  setBudgetOverride(Number.isFinite(parsed) ? parsed : null);
                }}
                keyboardType="number-pad"
                placeholder="minutes"
                placeholderTextColor="rgba(17,17,17,0.4)"
                className="flex-1 text-[15px] text-ink"
              />
              <Text className="text-[13px] font-semibold text-ink/40">min / day</Text>
            </View>
          </SolidShadow>
        ) : null}

        <ShieldPreview sidekickName={sidekickName} budgetMinutes={budgetMinutes} streak={0} />

        {enabled ? (
          <Text
            onPress={() => turnOff.mutate()}
            className="text-[14px] font-semibold text-flame text-center mt-7 py-2"
          >
            Turn off focus
          </Text>
        ) : null}
      </ScrollView>

      <View
        className="absolute inset-x-0 bottom-0 px-5 pt-3 bg-white"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <PrimaryButton
          label="start guarding"
          onPress={() => start.mutate()}
          disabled={!ready || !available}
          loading={start.isPending}
        />
      </View>
    </View>
  );
}
