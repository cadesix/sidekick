import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Plus } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isFocusGoalSlug } from "@sidekick/shared";
import { OptionCard } from "~/components/OptionCard";
import { PrimaryButton } from "~/components/PrimaryButton";
import { SolidShadow } from "~/components/SolidShadow";
import { adoptGoal } from "~/lib/api";
import { GOAL_CATALOG } from "~/lib/goals";

const CATALOG = Object.entries(GOAL_CATALOG).map(([slug, entry]) => ({ slug, ...entry }));
const CUSTOM = "custom";

export default function AddGoal() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const queryClient = useQueryClient();

  const adopt = useMutation({
    mutationFn: () => {
      if (selected === CUSTOM) {
        return adoptGoal({ slug: CUSTOM, label: customText.trim(), cadence: { type: "daily" } });
      }
      return adoptGoal({ slug: selected! });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      // Doomscroll/procrastinate goals can be OS-enforced — offer focus setup right away (13).
      if (selected !== null && isFocusGoalSlug(selected)) {
        router.replace("/focus-setup");
        return;
      }
      router.back();
    },
  });

  const ready = selected !== null && (selected !== CUSTOM || customText.trim().length > 0);

  return (
    <View className="flex-1 bg-white" style={{ paddingBottom: insets.bottom + 20 }}>
      <View className="items-center pt-3 pb-1">
        <View className="w-10 h-1.5 rounded-full bg-ink/12" />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-[27px] font-extrabold tracking-[-0.02em] leading-[1.15] text-ink">
          What do you want to work on?
        </Text>
        <Text className="text-[15px] leading-[1.6] text-ink/55 mt-1 mb-5">Pick one to start.</Text>

        <View className="gap-2.5">
          {CATALOG.map((goal, i) => (
            <OptionCard
              key={goal.slug}
              label={goal.label}
              icon={goal.icon}
              index={i}
              selected={selected === goal.slug}
              onPress={() => setSelected(goal.slug)}
            />
          ))}

          <OptionCard
            label="Something else…"
            icon={null}
            index={CATALOG.length}
            selected={selected === CUSTOM}
            onPress={() => setSelected(CUSTOM)}
          />
          {selected === CUSTOM ? (
            <SolidShadow>
              <View className="flex-row items-center gap-2 bg-white rounded-2xl px-4 py-3">
                <Plus size={18} color="rgba(17,17,17,0.4)" strokeWidth={2.5} />
                <TextInput
                  value={customText}
                  onChangeText={setCustomText}
                  placeholder="Name your goal"
                  placeholderTextColor="rgba(17,17,17,0.4)"
                  className="flex-1 text-[15px] text-ink"
                  autoFocus
                />
              </View>
            </SolidShadow>
          ) : null}
        </View>
      </ScrollView>

      <View className="px-5 pt-2">
        <PrimaryButton
          label="Add goal"
          onPress={() => adopt.mutate()}
          disabled={!ready}
          loading={adopt.isPending}
        />
      </View>
    </View>
  );
}
