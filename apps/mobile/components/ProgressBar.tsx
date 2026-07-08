import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";

/**
 * Segmented onboarding progress (06 §3.6). N segments; each fills left-to-right.
 * The first segment is seeded to 15% at step 0 so it never reads as "no
 * progress". Fill animates over 500ms ease-out.
 */
function Segment({ percent }: { percent: number }) {
  const style = useAnimatedStyle(
    () => ({
      transform: [
        { scaleX: withTiming(percent / 100, { duration: 500, easing: Easing.out(Easing.ease) }) },
      ],
    }),
    [percent],
  );
  return (
    <View className="flex-1 h-2 rounded-full bg-field overflow-hidden">
      <Animated.View
        style={[{ position: "absolute", left: 0, top: 0, bottom: 0, right: 0, transformOrigin: "left" }, style]}
        className="bg-sky rounded-full"
      />
    </View>
  );
}

function segmentPercent(index: number, current: number): number {
  if (index < current) {
    return 100;
  }
  if (index === 0 && current === 0) {
    return 15;
  }
  return 0;
}

export function ProgressBar({ steps, current }: { steps: number; current: number }) {
  return (
    <View className="flex-row gap-1.5">
      {Array.from({ length: steps }, (_, i) => (
        <Segment key={i} percent={segmentPercent(i, current)} />
      ))}
    </View>
  );
}
