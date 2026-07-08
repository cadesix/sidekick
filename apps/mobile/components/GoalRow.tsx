import { Image, type ImageSourcePropType, Pressable, Text, View } from "react-native";
import { Check, Flame, Shield } from "lucide-react-native";
import type { FocusChipState } from "@sidekick/shared";
import { pastelFor } from "~/lib/tokens";

/** The focus shield chip (13 §home): under-budget or actively-blocked. */
function ShieldChip({ state }: { state: "under" | "blocked" }) {
  const label = state === "blocked" ? "blocked" : "under budget";
  return (
    <View className="flex-row items-center gap-1 rounded-full bg-ink/8 px-2 py-1">
      <Shield size={12} color="#111" strokeWidth={2.5} />
      <Text className="text-[11px] font-bold text-ink/70">{label}</Text>
    </View>
  );
}

/**
 * A goal on the home list (06 §3.8 / 07 §1). Right side shows a per-goal streak
 * flame, or a 24px ink check circle when the goal is done today. For focus-backed
 * goals with active blocking, a shield chip (13) sits before the streak.
 */
export function GoalRow({
  label,
  icon,
  index,
  streak,
  doneToday,
  shield = null,
  onPress,
}: {
  label: string;
  icon: ImageSourcePropType | null;
  index: number;
  streak: number;
  doneToday: boolean;
  shield?: FocusChipState;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: pastelFor(index) }}
      className="flex-row items-center gap-3 rounded-2xl pl-3 pr-4 py-2.5 active:scale-[0.99]"
    >
      {icon ? <Image source={icon} className="w-10 h-10" resizeMode="contain" /> : null}
      <Text className="flex-1 text-[16px] font-bold text-ink">{label}</Text>
      {shield ? <ShieldChip state={shield} /> : null}
      {doneToday ? (
        <View className="w-6 h-6 rounded-full bg-ink items-center justify-center">
          <Check size={14} color="#fff" strokeWidth={3.5} />
        </View>
      ) : (
        <View className="flex-row items-center gap-1.5">
          <Flame size={16} color="#FF9F43" strokeWidth={2.5} />
          <Text className="text-[13px] font-bold text-ink/55">{streak}</Text>
        </View>
      )}
    </Pressable>
  );
}
