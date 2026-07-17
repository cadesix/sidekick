import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { BOND_MIN } from '@sidekick/core';

import { useSnapshot } from '../lib/state';
import type { OverheadTarget } from './SidekickCanvas';

// The way into the night sky: a star hanging above the sidekick that opens the
// next star chat, with the bond score riding alongside it. Head-tracked off the
// same projected bone point the speech bubble uses, so it follows the character
// rather than sitting at a fixed corner — and it drifts, so it reads as floating
// in the sky rather than pinned to a UI layer.
//
// Hidden once every session is done: there's nothing left to open.

const SIZE = 48; // pill height (BADGE 36 + 6 padding each side) — vertical centering
// The tracked point is the head BONE — the top of the head. Sit ABOVE it, so the
// star reads as hanging in the SKY the chat pans up into rather than as a button
// stuck to the character.
//
// Horizontally the whole row (star + score) is CENTRED on the head: the head is
// centre-screen on a phone, so any fixed rightward offset ran the label off the
// edge. Centring is measured, not guessed, because the row's width moves with
// the score ("bond score 5%" vs "bond score 100%").
//
// Vertically it must clear the speech bubble, which bottom-anchors at the same
// head point and grows UPWARD as its line wraps (OverheadSpeech). Centring the
// row removed the sideways clearance the old offset had, so the star started
// painting over what the sidekick was saying. This sits above the bubble's
// realistic reach: ~100px of wrapped text, plus the star's half-height and its
// vertical drift.
const OFFSET_Y = -150;

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
  // server-driven bond (plan 20): the snapshot, patched when a session completes
  const bond = useSnapshot().data?.bond ?? BOND_MIN;

  // Twinkle (a slow shimmer, so it reads as invitation rather than chrome) and
  // drift (a free-running 0→1 ramp the Lissajous reads off — linear and
  // non-reversing, so the sines stay continuous instead of bouncing at the
  // ends). Both are stopped while hidden: this component stays MOUNTED behind
  // the map, shop, chat and the entire guided session, so left running they'd
  // tick two worklets a frame into an invisible view — during the session, on
  // top of the sky's own 550-star draw.
  const t = useSharedValue(0);
  const drift = useSharedValue(0);
  useEffect(() => {
    if (hidden) {
      cancelAnimation(t);
      cancelAnimation(drift);
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
    drift.value = withRepeat(withTiming(1, { duration: FLOAT_MS, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(t);
      cancelAnimation(drift);
    };
  }, [hidden, t, drift]);

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
      {/* one pill = one tap target: the star and the bond score sit inside it,
          and tapping anywhere on it opens the star chat */}
      <Pressable
        onPress={onPress}
        accessibilityLabel={`Start a star chat — bond score ${bond} percent`}
        style={({ pressed }) => [styles.pill, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
      >
        <View style={styles.starWrap}>
          <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]} />
          <View style={styles.starBadge}>
            <Animated.View style={starStyle}>
              <Text style={styles.star}>✦</Text>
            </Animated.View>
          </View>
        </View>
        <Animated.Text style={[styles.label, labelStyle]}>bond score {bond}%</Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

const BADGE = 36; // the purple star disc inside the pill

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 26,
  },
  // the whole pill is the tap target
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 15,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  starWrap: {
    width: BADGE,
    height: BADGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: BADGE + 8,
    height: BADGE + 8,
    borderRadius: (BADGE + 8) / 2,
    backgroundColor: '#C9BCFF',
  },
  starBadge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(122,90,248,0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  star: {
    fontSize: 18,
    lineHeight: 22,
    color: '#fff',
  },
  // dark ink now — it sits inside a light pill, not over the open sky
  label: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
});
