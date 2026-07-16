import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { OverheadTarget } from './SidekickCanvas';

// The way into a star chat from home: a star that hangs beside the sidekick's
// head and twinkles. Head-tracked off the same projected bone point the bond
// badge uses, so it follows the character rather than sitting at a fixed corner.
//
// Hidden once every session is done — there's nothing left to open.

const SIZE = 44;
// The tracked point is the head BONE — the top of the head, which is also what
// the bond badge hangs above. So drop down and out to sit beside the face
// instead of crowding the badge.
const OFFSET_X = 78;
const OFFSET_Y = 58;

export function StarChatButton({
  overhead,
  hidden,
  onPress,
}: {
  overhead: OverheadTarget;
  hidden?: boolean;
  onPress: () => void;
}) {
  // a slow twinkle so it reads as invitation rather than chrome
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [t]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: overhead.x.value + OFFSET_X - SIZE / 2 },
      { translateY: overhead.y.value + OFFSET_Y - SIZE / 2 },
    ],
    opacity: hidden ? 0 : overhead.visible.value,
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.35, 0.75]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.9, 1.25]) }],
  }));
  const starStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(t.value, [0, 1], [0.94, 1.06]) }],
  }));

  return (
    <Animated.View style={[styles.box, boxStyle]} pointerEvents={hidden ? 'none' : 'box-none'}>
      <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]} />
      <Pressable
        onPress={onPress}
        accessibilityLabel="Start a star chat"
        style={({ pressed }) => [styles.hit, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}
      >
        <Animated.View style={starStyle}>
          <Text style={styles.star}>✦</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 26,
  },
  glow: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#C9BCFF',
  },
  hit: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,90,248,0.9)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  star: {
    fontSize: 20,
    lineHeight: 24,
    color: '#fff',
  },
});
