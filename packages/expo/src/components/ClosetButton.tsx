import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Pressable } from './Pressable';
import { SidekickAvatar } from './SidekickAvatar';
import type { OverheadTarget } from './SidekickCanvas';

// The closet/inventory entry: the live head avatar floating beside the
// sidekick's head (the star pill hangs above-left; this balances it on the
// right), head-tracked off the same projected bone point and drifting on its
// own lazy Lissajous so the pair reads as a loose halo, not a locked HUD.
//
// GL caveat (same as the old top-right cluster button): the avatar owns a GL
// context, so this stays MOUNTED and is hidden with opacity/pointerEvents —
// unmounting (or display:none) lets iOS tear down the offscreen GLView, and
// re-showing it would rebuild context + GLB + wardrobe, a visible hitch. The
// avatar's render loop is `paused` while hidden so it costs nothing per frame.

const SIZE = 48;
// right of the head, a touch lower than the star pill so the two never collide
// even at opposite drift extremes
const OFFSET_X = 64;
const OFFSET_Y = -64;

// same wander recipe as the star, different rates/phase so they don't move in
// lockstep (that would read as one rigid plate)
const FLOAT_X = 6;
const FLOAT_Y = 9;
const FLOAT_MS = 13000;
const TAU = Math.PI * 2;

export function ClosetButton({
  overhead,
  hidden,
  paused,
  onPress,
}: {
  overhead: OverheadTarget;
  hidden?: boolean;
  // freeze the avatar's GL loop (closet open, or hidden under a surface)
  paused?: boolean;
  onPress: () => void;
}) {
  const drift = useSharedValue(0);
  useEffect(() => {
    if (hidden) {
      cancelAnimation(drift);
      return;
    }
    drift.value = withRepeat(withTiming(1, { duration: FLOAT_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(drift);
  }, [hidden, drift]);

  const boxStyle = useAnimatedStyle(() => {
    const p = drift.value * TAU;
    const fx = Math.sin(p * 0.83 + 2.4) * FLOAT_X;
    const fy = Math.sin(p * 0.57 + 0.4) * FLOAT_Y;
    return {
      transform: [
        { translateX: overhead.x.value + OFFSET_X + fx - SIZE / 2 },
        { translateY: overhead.y.value + OFFSET_Y + fy - SIZE / 2 },
      ],
      opacity: hidden ? 0 : overhead.visible.value,
    };
  });

  return (
    <Animated.View style={[styles.box, boxStyle]} pointerEvents={hidden ? 'none' : 'box-none'}>
      <Pressable onPress={onPress} accessibilityLabel="Appearance" style={styles.circle}>
        <SidekickAvatar size={SIZE} style={{ transform: [{ scale: 1.1 }] }} paused={paused} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 26,
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
});
