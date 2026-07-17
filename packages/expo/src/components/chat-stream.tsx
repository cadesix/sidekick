import { useEffect, useState } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';

// Shared chat-streaming primitives for the star-chat / onboarding runners: a
// typewriter reveal, the typing dots, and the timing helper the sequencers use
// to hold the next bot line until the current one finishes (one at a time).

export const STREAM_CPS = 42; // characters per second
export const STREAM_GAP_MS = 260; // breath between lines, after one finishes

export function streamDurationMs(text: string): number {
  return Math.ceil(text.length * (1000 / STREAM_CPS));
}

// keeps white text legible where it overlaps the constellation's white stars
export const MSG_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
} as const;

// Reveals `text` a few characters at a time. Streams once on mount (message keys
// are stable + append-only, so it never re-types an already-shown line);
// onReveal lets the parent keep the newest line in view as it grows.
export function StreamedText({
  text,
  className,
  style,
  onReveal,
}: {
  text: string;
  className?: string;
  style?: TextStyle;
  onReveal?: () => void;
}) {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (shown >= text.length) return;
    const id = setTimeout(() => {
      setShown((n) => Math.min(text.length, n + 1));
      onReveal?.();
    }, 1000 / STREAM_CPS);
    return () => clearTimeout(id);
  }, [shown, text, onReveal]);
  return (
    <Text className={className} style={style}>
      {text.slice(0, shown)}
    </Text>
  );
}

function Dot({ delay }: { delay: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 500 }), -1, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={style} className="w-2 h-2 rounded-full bg-white/70" />;
}

export function TypingDots() {
  return (
    <View className="flex-row gap-1 py-1">
      <Dot delay={0} />
      <Dot delay={160} />
      <Dot delay={320} />
    </View>
  );
}
