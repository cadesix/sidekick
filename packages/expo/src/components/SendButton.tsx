import { Pressable } from "react-native";
import { ArrowUp } from "lucide-react-native";

/**
 * 44px sun circle with a white up-arrow (06 §3.2). No shadow, no border. Disabled
 * (empty input) → 40% opacity. Simple opacity press — this is not a solid-shadow
 * surface.
 */
export function SendButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className={`w-11 h-11 rounded-full bg-sun items-center justify-center ${
        disabled ? "opacity-40" : "active:opacity-80"
      }`}
      accessibilityRole="button"
      accessibilityLabel="Send message"
    >
      <ArrowUp size={20} color="#fff" strokeWidth={3} />
    </Pressable>
  );
}
