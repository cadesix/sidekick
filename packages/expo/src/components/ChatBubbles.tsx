import { useEffect } from "react";
import { Image, Text, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const AVATAR = require("../../assets/sidekick-pfp.webp");

const SIDEKICK_CORNERS = { borderRadius: 24, borderBottomLeftRadius: 6 } as const;
const USER_CORNERS = { borderRadius: 24, borderBottomRightRadius: 6 } as const;

function Avatar() {
  return <Image source={AVATAR} className="w-8 h-8" resizeMode="contain" />;
}

/** Left-aligned cream bubble with the 32px sidekick avatar (06 §3.3). */
export function SidekickBubble({ text }: { text: string }) {
  return (
    <View className="flex-row items-end gap-2 max-w-[85%]">
      <Avatar />
      <View className="bg-cream px-4 py-2.5" style={SIDEKICK_CORNERS}>
        <Text className="text-[15px] leading-[1.375] text-ink">{text}</Text>
      </View>
    </View>
  );
}

/** Right-aligned gray user bubble (06 §3.3). */
export function UserBubble({ text }: { text: string }) {
  return (
    <View className="self-end max-w-[80%]">
      <View className="bg-usergray px-4 py-2.5" style={USER_CORNERS}>
        <Text className="text-[15px] leading-[1.375] text-ink">{text}</Text>
      </View>
    </View>
  );
}

function Dot({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: Math.floor(progress.value) === index ? 1 : 0.3,
  }));
  return <Animated.Text style={style} className="text-[15px] leading-[1.375] text-ink/40">•</Animated.Text>;
}

/**
 * The typing indicator (06 §3.3): a cream bubble with the SAME padding and
 * line-box as a one-line text bubble, so replacing it with the streamed reply
 * causes no layout jump. Dots animate on a 1.6s loop (Reanimated, never
 * setTimeout).
 */
export function TypingBubble() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withTiming(3, { duration: 1600, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress]);
  return (
    <View className="flex-row items-end gap-2 max-w-[85%]">
      <Avatar />
      <View className="bg-cream px-4 py-2.5 flex-row gap-1" style={SIDEKICK_CORNERS}>
        <Dot index={0} progress={progress} />
        <Dot index={1} progress={progress} />
        <Dot index={2} progress={progress} />
      </View>
    </View>
  );
}
