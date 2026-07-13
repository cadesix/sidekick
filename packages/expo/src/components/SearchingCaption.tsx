import { Text } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

/**
 * The "looking it up…" caption that fades in beneath the typing indicator while a
 * web search streams (11 §citations UI). No spinner, no banner — just a quiet
 * Caption line, aligned past the avatar, that fades out the moment text arrives.
 */
export function SearchingCaption() {
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(220)} className="pl-10">
      <Text className="text-[12px] font-medium text-ink/40">looking it up…</Text>
    </Animated.View>
  );
}
