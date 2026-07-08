import { Image, type ImageSourcePropType, Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { pastelFor } from "~/lib/tokens";

/**
 * Onboarding / goal-catalog card (06 §3.5): pastel fill by index, 56px icon,
 * bold label, an ink check circle when selected. Press scales slightly — the
 * pastel fill is the whole affordance, not a solid shadow.
 */
export function OptionCard({
  label,
  icon,
  index,
  selected,
  onPress,
}: {
  label: string;
  icon: ImageSourcePropType | null;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: pastelFor(index) }}
      className="w-full flex-row items-center gap-4 rounded-2xl pl-3 pr-5 py-2.5 active:scale-[0.99]"
    >
      {icon ? <Image source={icon} className="w-14 h-14" resizeMode="contain" /> : null}
      <Text className="flex-1 text-[17px] font-bold leading-[1.2] text-ink">{label}</Text>
      {selected ? (
        <View className="w-6 h-6 rounded-full bg-ink items-center justify-center">
          <Check size={14} color="#fff" strokeWidth={3.5} />
        </View>
      ) : null}
    </Pressable>
  );
}
