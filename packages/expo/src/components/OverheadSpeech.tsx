import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import type { OverheadTarget } from './SidekickCanvas';

// Head-tracked anchor for whatever the sidekick is saying: the canvas writes the
// head-bone's screen position into `overhead` every frame, so this only owns
// placement — children bottom-anchor just above the head.
//
// This was BondBadge, which also drew the heart + "bond score N%" + progress
// bar. The score now rides beside the star (StarChatButton) instead, so all
// that's left here is the speech bubble's position.

// fixed box so we can bottom-center-anchor at the head point without measuring
const BOX_W = 240;
const BOX_H = 160;

export function OverheadSpeech({
  overhead,
  hidden,
  children,
}: {
  overhead: OverheadTarget;
  hidden?: boolean;
  children?: React.ReactNode;
}) {
  const boxStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: overhead.x.value - BOX_W / 2 },
      { translateY: overhead.y.value - BOX_H },
    ],
    opacity: hidden ? 0 : overhead.visible.value,
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.box, boxStyle]}>
      {children}
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
});
