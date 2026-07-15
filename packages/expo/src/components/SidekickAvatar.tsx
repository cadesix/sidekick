import Constants from 'expo-constants';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useCosmeticVersion } from '../store/cosmeticVersion';
import { createAvatarRenderer, type AvatarController } from '../three/avatar';

// Drop-in live head avatar — RN analog of web's <SidekickAvatar>. A small GLView
// rendering just the character's head (cel-shaded body color, smiling face, worn
// hats/glasses), transparent background so it floats on the UI. Web reuses one
// cached snapshot image everywhere; expo-gl can't read pixels back, so this is a
// live context — use it sparingly (top cluster, chat header), not once per row.
//
// It regenerates on outfit change: the `key` is keyed to the cosmetic-version
// counter, so equipping a hat remounts the GLView and reloads the wardrobe.
export function SidekickAvatar({ size = 32, style }: { size?: number; style?: ViewStyle }) {
  const version = useCosmeticVersion((st) => st.v);
  const controller = useRef<AvatarController | null>(null);

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    controller.current?.dispose();
    controller.current = createAvatarRenderer(gl);
  };

  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none">
      <GLView
        key={version}
        style={StyleSheet.absoluteFill}
        msaaSamples={Constants.isDevice ? 4 : 0}
        onContextCreate={onContextCreate}
      />
    </View>
  );
}
