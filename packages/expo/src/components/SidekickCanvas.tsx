import Constants from 'expo-constants';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import type { BoxTier } from '@sidekick/core';

import { NO_BROWSER_PAN } from '../lib/web-style';
import type { EnvironmentId } from '../three/biomes';
import { createSidekickRenderer, type Framing, type SidekickController } from '../three/renderer';
import type { CosmeticsControls } from '../three/wardrobe';
import { SCENE_3D_ENABLED } from '../three/enabled';
import { SceneFallback } from './SceneFallback';

// Head-tracked overlay target: the canvas writes the head-bone's on-screen
// position (layout px) + visibility into these SharedValues every frame; a
// head-tracked overlay (bond badge, speech bubble) reads them via useAnimatedStyle.
export type OverheadTarget = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  visible: SharedValue<number>; // 1 = in front of camera, 0 = behind/hidden
};

// RN analog of sidekick/src/components/sidekick-canvas.tsx: a GLView hosting the
// imperative THREE scene. Props (framing, holdingPhone, studio) are pushed to
// the controller imperatively, exactly like the web version mirrored props into
// refs. onControls receives the imperative dressing handle once cosmetics load
// (null again on dispose) — the web version used a MutableRefObject for this.
//
// Touch: the wrapper view is a plain responder feeding the interaction layer
// (poke/drag/camera-orbit) in NDC. Overlay UI (dock, sheets, drawer) sits above
// this view, so it only sees touches nothing else claimed.

export function SidekickCanvas({
  style,
  framing,
  holdingPhone,
  talking,
  studio,
  environment,
  onControls,
  onController,
  overhead,
  dailyBox,
  ground,
  cosmos,
  starFace,
}: {
  style?: ViewStyle;
  framing: Framing;
  holdingPhone?: boolean;
  talking?: boolean;
  // Shop "studio": hide the meadow and show the character on a clean backdrop
  studio?: boolean;
  // Guided session: crossfade the meadow → night sky + a progress constellation
  cosmos?: boolean;
  // TEMPORARY: live look-dev for the sky constellation (store/starFaceConfig)
  starFace?: Parameters<SidekickController['setStarFace']>[0];
  // world environment (map travel): 'meadow' | biome id
  environment?: EnvironmentId;
  onControls?: (c: CosmeticsControls | null) => void;
  // the raw scene controller (Settings sheet uses applySettings for live look-dev)
  onController?: (c: SidekickController | null) => void;
  // head-tracked overlay position sink (bond badge / speech bubble)
  overhead?: OverheadTarget;
  // daily loot chest tier (spawns the 3D chest) + its ground-anchor sink
  dailyBox?: BoxTier | null;
  ground?: OverheadTarget;
}) {
  const controller = useRef<SidekickController | null>(null);
  // keep the latest callbacks without re-creating the GL scene
  const onControlsRef = useRef(onControls);
  onControlsRef.current = onControls;
  const onControllerRef = useRef(onController);
  onControllerRef.current = onController;
  const overheadRef = useRef(overhead);
  overheadRef.current = overhead;
  const groundRef = useRef(ground);
  groundRef.current = ground;
  const size = useRef({ w: 1, h: 1 });

  // NDC (-1..1, +y up) → layout px (top-left origin)
  const project = (t: OverheadTarget | undefined, nx: number, ny: number, visible: boolean) => {
    if (!t) return;
    t.x.value = (nx * 0.5 + 0.5) * size.current.w;
    t.y.value = (-ny * 0.5 + 0.5) * size.current.h;
    t.visible.value = visible ? 1 : 0;
  };

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    controller.current = createSidekickRenderer(gl, {
      framing,
      holdingPhone,
      studio,
      cosmos,
      environment,
      dailyBox,
      onControls: (c) => onControlsRef.current?.(c),
      onOverhead: (nx, ny, visible) => project(overheadRef.current, nx, ny, visible),
      onGround: (nx, ny, visible) => project(groundRef.current, nx, ny, visible),
    });
    onControllerRef.current?.(controller.current);
  };

  // view px → NDC (-1..1, +y up)
  const toNdc = (e: GestureResponderEvent): [number, number] => {
    const { locationX, locationY } = e.nativeEvent;
    return [
      (locationX / size.current.w) * 2 - 1,
      -((locationY / size.current.h) * 2 - 1),
    ];
  };

  useEffect(() => {
    controller.current?.setFraming(framing);
  }, [framing]);

  useEffect(() => {
    controller.current?.setHoldingPhone(!!holdingPhone);
  }, [holdingPhone]);

  useEffect(() => {
    controller.current?.setTalking(!!talking);
  }, [talking]);

  useEffect(() => {
    if (environment) controller.current?.setEnvironment(environment);
  }, [environment]);

  useEffect(() => {
    controller.current?.setStudio(!!studio);
  }, [studio]);

  useEffect(() => {
    controller.current?.setCosmos(!!cosmos);
  }, [cosmos]);

  useEffect(() => {
    if (starFace) controller.current?.setStarFace(starFace);
  }, [starFace]);

  useEffect(() => {
    controller.current?.setDailyBox(dailyBox ?? null);
  }, [dailyBox]);

  useEffect(() => {
    return () => {
      onControllerRef.current?.(null);
      controller.current?.dispose();
    };
  }, []);

  // Simulators (and the EXPO_PUBLIC_DISABLE_3D escape hatch) stay on the
  // lightweight fallback — expo-gl's software renderer misbehaves there and a
  // scene failure can take down unrelated app flows.
  if (!SCENE_3D_ENABLED) return <SceneFallback style={StyleSheet.flatten([styles.fill, style])} />;

  return (
    <View
      // NO_BROWSER_PAN: on web this drag orbits the camera, so the browser must
      // not also read it as a page pan/zoom
      style={[styles.fill, NO_BROWSER_PAN, style]}
      onLayout={(e) => {
        size.current = { w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 };
      }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => controller.current?.pointerDown(...toNdc(e))}
      onResponderMove={(e) => controller.current?.pointerMove(...toNdc(e))}
      onResponderRelease={(e) => controller.current?.pointerUp(...toNdc(e))}
      onResponderTerminate={(e) => controller.current?.pointerUp(...toNdc(e))}
    >
      {/* MSAA on real hardware (matches the web's antialias:true); 0 on the
          simulator, whose MSAA resolve intermittently drops skinned draws */}
      <GLView
        style={styles.fill}
        pointerEvents="none"
        msaaSamples={Constants.isDevice ? 4 : 0}
        onContextCreate={onContextCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
