import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";

/**
 * Generic bottom sheet (06 §3.9): rounded-t-32 white surface with a grabber
 * handle and a soft (blurred, allowed) top shadow, over a tappable scrim. Slides
 * up/down with the sheet motion. Renders nothing when closed.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!visible) {
    return null;
  }
  return (
    <View className="absolute inset-0 z-50" style={{ justifyContent: "flex-end" }}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} className="absolute inset-0">
        <Pressable onPress={onClose} className="flex-1 bg-black/25" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.duration(450)}
        exiting={SlideOutDown.duration(400)}
        className="bg-white rounded-t-[32px]"
        style={{ shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 30, shadowOffset: { width: 0, height: -10 }, elevation: 20 }}
      >
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-ink/12" />
        </View>
        <View className="max-w-md mx-auto w-full px-5 pb-8">{children}</View>
      </Animated.View>
    </View>
  );
}
