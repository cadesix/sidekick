import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useBond } from '../store/bond';
import type { OverheadTarget } from './SidekickCanvas';

// The way into the night sky: a star hanging above the sidekick that opens the
// next star chat, with the bond score riding alongside it. Head-tracked off the
// same projected bone point the speech bubble uses, so it follows the character
// rather than sitting at a fixed corner — and it drifts, so it reads as floating
// in the sky rather than pinned to a UI layer.
//
// Hidden once every session is done: there's nothing left to open.

const SIZE = 44;
// The tracked point is the head BONE — the top of the head. Sit ABOVE it, so the
// star reads as hanging in the SKY the chat pans up into rather than as a button
// stuck to the character.
//
// Horizontally the whole row (star + score) is CENTRED on the head: the head is
// centre-screen on a phone, so any fixed rightward offset ran the label off the
// edge. Centring is measured, not guessed, because the row's width moves with
// the score ("bond score 5%" vs "bond score 100%").
const OFFSET_Y = -64;

// A lazy drift so it feels like it's floating rather than pinned. Two sines at
// different rates (and out of phase) trace a slow wander instead of an obvious
// loop; the periods are deliberately not multiples of each other. The label is
// inside the same drifting box, so it stays welded to the star.
const FLOAT_X = 7; // px
const FLOAT_Y = 10;
const FLOAT_MS = 11000;
const TAU = Math.PI * 2;

export function StarChatButton({
  overhead,
  hidden,
  onPress,
}: {
  overhead: OverheadTarget;
  hidden?: boolean;
  onPress: () => void;
}) {
  const bond = useBond((s) => s.bond);

  // a slow twinkle so it reads as invitation rather than chrome
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [t]);

  // free-running 0→1 ramp the drift reads off. Linear and non-reversing, so the
  // sines below stay continuous instead of bouncing at the ends.
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: FLOAT_MS, easing: Easing.linear }), -1, false);
  }, [drift]);

  // the score still pops when it goes up — the one bit of the old bond badge
  // worth keeping now the bar is gone
  const pop = useSharedValue(1);
  const prev = useRef(bond);
  useEffect(() => {
    if (bond > prev.current) {
      pop.value = withSequence(
        withTiming(1.18, { duration: 150 }),
        withSpring(1, { damping: 7, stiffness: 150 }),
      );
    }
    prev.current = bond;
  }, [bond, pop]);

  // measured row width, so the group can be centred on the head without
  // hard-coding a guess at how wide "bond score NN%" renders
  const rowW = useSharedValue(SIZE);

  const boxStyle = useAnimatedStyle(() => {
    const p = drift.value * TAU;
    // 1 : 0.63 with a phase offset — near enough to a Lissajous that the path
    // never visibly repeats at a glance
    const fx = Math.sin(p) * FLOAT_X;
    const fy = Math.sin(p * 0.63 + 1.1) * FLOAT_Y;
    return {
      transform: [
        { translateX: overhead.x.value + fx - rowW.value / 2 },
        { translateY: overhead.y.value + OFFSET_Y + fy - SIZE / 2 },
      ],
      opacity: hidden ? 0 : overhead.visible.value,
    };
  });
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.35, 0.75]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.9, 1.25]) }],
  }));
  const starStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(t.value, [0, 1], [0.94, 1.06]) }],
  }));
  const labelStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Animated.View
      style={[styles.box, boxStyle]}
      pointerEvents={hidden ? 'none' : 'box-none'}
      onLayout={(e) => {
        rowW.value = e.nativeEvent.layout.width;
      }}
    >
      <View style={styles.starWrap} pointerEvents="box-none">
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
      </View>
      <Animated.Text style={[styles.label, labelStyle]} pointerEvents="none">
        bond score {bond}%
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 26,
  },
  starWrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
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
  // matches the old bond badge's type: mono, inked so it survives a bright sky
  label: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
