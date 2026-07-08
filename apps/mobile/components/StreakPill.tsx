import { Text, View } from "react-native";
import { Flame } from "lucide-react-native";

/**
 * Streak pill (06 §3.7). `onPhoto` puts it on the translucent white chip used over
 * the home backdrop; otherwise it sits on the neutral field fill.
 */
export function StreakPill({ count, onPhoto = false }: { count: number; onPhoto?: boolean }) {
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${
        onPhoto ? "bg-white/90" : "bg-field"
      }`}
    >
      <Flame size={16} color="#FF9F43" strokeWidth={2.5} />
      <Text className="text-[15px] font-bold text-ink">{count}</Text>
    </View>
  );
}
