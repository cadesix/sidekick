import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useCosmeticVersion } from '../store/cosmeticVersion';
import { createAvatarRenderer, type AvatarController } from '../three/avatar';
import { SCENE_3D_ENABLED } from '../three/enabled';

// Drop-in live head avatar — RN analog of web's <SidekickAvatar>. A small GLView
// rendering just the character's head (cel-shaded body color, smiling face, worn
// hats/glasses), transparent background so it floats on the UI. Web reuses one
// cached snapshot image everywhere; expo-gl can't read pixels back, so this is a
// live context — use it sparingly (top cluster, chat header), not once per row.
//
// It regenerates on outfit change: the `key` is keyed to the cosmetic-version
// counter, so equipping a hat remounts the GLView and reloads the wardrobe.
export function SidekickAvatar({
  size = 32,
  style,
  paused = false,
}: {
  size?: number;
  style?: ViewStyle;
  // freeze the render loop (the head is static) to free the GPU while a heavy
  // sheet is open over it
  paused?: boolean;
}) {
  const version = useCosmeticVersion((st) => st.v);
  const controller = useRef<AvatarController | null>(null);

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    controller.current?.dispose();
    controller.current = createAvatarRenderer(gl);
    controller.current.setPaused(paused);
  };

  useEffect(() => {
    controller.current?.setPaused(paused);
  }, [paused]);

  // tear the GL context down on unmount — without this the render loop keeps
  // running on a dead GLView and the context is never freed, leaking toward the
  // browser's ~16-context cap
  useEffect(() => {
    return () => {
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  // Simulator / 3D-disabled: the static mascot pfp stands in for the live head.
  if (!SCENE_3D_ENABLED) {
    return (
      <View style={[{ width: size, height: size }, style]} pointerEvents="none">
        <Image source={require('../../assets/sidekick-pfp.webp')} style={StyleSheet.absoluteFill} contentFit="contain" />
      </View>
    );
  }

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
