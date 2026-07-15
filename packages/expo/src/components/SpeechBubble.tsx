import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useSpeech } from '../store/speech';

// RN port of sidekick/src/components/speech-bubble.tsx. Rendered inside the
// head-tracked BondBadge stack, so it floats above the pill and tracks the head
// for free. Springs in on speak(), fades out after `ms`. Bubble + a rotated tail
// pointing down at the head.

export function SpeechBubble() {
  const nonce = useSpeech((s) => s.nonce);
  const [shown, setShown] = useState<string | null>(null);
  const scale = useSharedValue(0.75);
  const opacity = useSharedValue(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (nonce === 0) return;
    const { text, ms } = useSpeech.getState();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setShown(text);
    scale.value = withSpring(1, { damping: 9, stiffness: 140, mass: 0.6 });
    opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
    timers.current.push(
      setTimeout(() => {
        scale.value = withTiming(0.75, { duration: 250 });
        opacity.value = withTiming(0, { duration: 250 });
      }, ms),
    );
    timers.current.push(setTimeout(() => setShown(null), ms + 300));
    return () => timers.current.forEach(clearTimeout);
  }, [nonce, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (shown === null) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, style]}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{shown}</Text>
      </View>
      {/* little tail pointing down at the head */}
      <View style={styles.tail} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  bubble: {
    maxWidth: 230,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  text: { textAlign: 'center', fontSize: 13, fontWeight: '700', lineHeight: 17, color: '#111' },
  tail: {
    marginTop: -5,
    height: 10,
    width: 10,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
    transform: [{ rotate: '45deg' }],
  },
});
