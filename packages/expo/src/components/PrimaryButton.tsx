import { ActivityIndicator, Text, View } from "react-native";
import { SolidShadow } from "./SolidShadow";

/**
 * Full-width black pill, white 16/600 label (06 §3.1). Disabled → 40% opacity,
 * no press. Loading → a white spinner in the pill's fixed size.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const inert = disabled || loading;
  return (
    <SolidShadow radius={999} onPress={inert ? undefined : onPress} disabled={inert}>
      <View
        className={`w-full py-4 items-center justify-center rounded-full bg-ink ${
          disabled ? "opacity-40" : ""
        }`}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-[16px] font-semibold">{label}</Text>
        )}
      </View>
    </SolidShadow>
  );
}
