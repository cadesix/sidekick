import { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { BOND_MAX } from '@sidekick/core';

import { useBond } from '../store/bond';
import type { OverheadTarget } from './SidekickCanvas';

// RN port of sidekick/src/components/bond-badge.tsx. Floats over the character's
// head: the canvas writes the head-bone screen position into `overhead` every
// frame, so this only owns the look — heart + "bond score N%" + amber progress
// bar + a springy pop when the score goes up. Children stack ABOVE the pill in
// the same head-tracked box (the speech bubble).

const BOND_ICON = require('../../assets/icons/bond.png');
// fixed box so we can bottom-center-anchor at the head point without measuring
const BOX_W = 240;
const BOX_H = 160;

export function BondBadge({
  overhead,
  hidden,
  children,
}: {
  overhead: OverheadTarget;
  hidden?: boolean;
  children?: React.ReactNode;
}) {
  const bond = useBond((s) => s.bond);
  const pop = useSharedValue(1);
  const fill = useSharedValue(bond);
  const prev = useRef(bond);

  useEffect(() => {
    fill.value = withTiming(bond, { duration: 500, easing: Easing.out(Easing.ease) });
    if (bond > prev.current) {
      pop.value = withSequence(
        withTiming(1.18, { duration: 150 }),
        withSpring(1, { damping: 7, stiffness: 150 }),
      );
    }
    prev.current = bond;
  }, [bond, fill, pop]);

  // anchor the box's bottom-center at the projected head point
  const boxStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: overhead.x.value - BOX_W / 2 },
      { translateY: overhead.y.value - BOX_H },
    ],
    opacity: hidden ? 0 : overhead.visible.value,
  }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const fillStyle = useAnimatedStyle(() => ({
    width: `${(fill.value / BOND_MAX) * 100}%`,
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.box, boxStyle]}>
      {children}
      <Animated.View style={[styles.badge, popStyle]}>
        <View style={styles.row}>
          <Image source={BOND_ICON} style={styles.heart} />
          <Text style={styles.label}>bond score {bond}%</Text>
        </View>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BOX_W,
    height: BOX_H,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  badge: { alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heart: { width: 24, height: 24, resizeMode: 'contain' },
  label: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  track: {
    marginTop: 2,
    height: 10,
    width: 160,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.25)',
    padding: 2,
  },
  // solid amber (the web's #ffd36b→#ff9b2b vertical gradient is imperceptible on
  // a ~6px-tall fill); upgrade to expo-linear-gradient if the shade is wanted
  fill: { height: '100%', borderRadius: 999, backgroundColor: '#ffb43a' },
});
