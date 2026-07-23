import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useEffect, useRef } from 'react';
import { PixelRatio, StyleSheet, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import type { BoxTier } from '@sidekick/core';

import { NO_BROWSER_PAN } from '../lib/web-style';
import { speak } from '../store/speech';
import type { EnvironmentId } from '../three/biomes';
import { createSidekickRenderer, type Framing, type SidekickController } from '../three/renderer';
import type { CosmeticsControls } from '../three/wardrobe';
import { SCENE_3D_ENABLED } from '../three/enabled';
import { SceneFallback } from './SceneFallback';

// Cap the effective render resolution at 2x DPR. expo-gl has no pixelRatio
// API — the drawing buffer always matches the GLView's untransformed size ×
// native scale — so on 3x devices the GLView is laid out at 2/3 size and
// scaled back up to fill. That renders ~44% of the pixels, the single biggest
// fill-rate (and thermal) lever we have; on-device A/B against native 3x was
// visually indistinguishable.
const dpr = PixelRatio.get();
const RENDER_SCALE = Math.min(2, dpr) / dpr;

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
  overheadActive,
  dailyBox,
  ground,
  cosmos,
  starFace,
  entrance,
  onFrameStats,
}: {
  style?: ViewStyle;
  framing: Framing;
  holdingPhone?: boolean;
  talking?: boolean;
  // Shop "studio": hide the meadow and show the character on a clean backdrop
  studio?: boolean;
  // Onboarding: park the character below the frame until controller.jumpIn().
  // Mount-time only (read once when the scene is created).
  entrance?: boolean;
  // Guided session: crossfade the meadow → night sky + a progress constellation
  cosmos?: boolean;
  // TEMPORARY: live look-dev for the sky constellation (store/starFaceConfig)
  starFace?: Parameters<SidekickController['setStarFace']>[0];
  // world environment (map travel): 'meadow' | biome id
  environment?: EnvironmentId;
  onControls?: (c: CosmeticsControls | null) => void;
  // the raw scene controller (applySettings, face pulses, daily-box pop)
  onController?: (c: SidekickController | null) => void;
  // head-tracked overlay position sink (bond badge / speech bubble)
  overhead?: OverheadTarget;
  // whether that overlay is currently on screen; false while a full surface
  // covers the character, so the renderer can skip the per-frame head projection
  overheadActive?: boolean;
  // daily loot chest tier (spawns the 3D chest) + its ground-anchor sink
  dailyBox?: BoxTier | null;
  ground?: OverheadTarget;
  // DEV: frame-timing report (fps, worst frame ms, worst in-loop JS ms, GL draw
  // calls, triangles) ~2x/sec
  onFrameStats?: (s: {
    fps: number;
    worstMs: number;
    worstJsMs: number;
    calls: number;
    tris: number;
    geometries: number;
    textures: number;
    programs: number;
    skipped: number;
    idle: number;
  }) => void;
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
  const onFrameStatsRef = useRef(onFrameStats);
  onFrameStatsRef.current = onFrameStats;
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
      entrance,
      environment,
      dailyBox,
      onControls: (c) => onControlsRef.current?.(c),
      // poke boil-over: the scene is already jumping/annoyed — layer on a buzz
      // and the "hey!" bubble over his head (the speech store drives it;
      // lowercase — the sidekick's voice, per the design system)
      onAngryPoke: () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        speak('hey!!', 2200);
      },
      onOverhead: (nx, ny, visible) => project(overheadRef.current, nx, ny, visible),
      onGround: (nx, ny, visible) => project(groundRef.current, nx, ny, visible),
      onFrameStats: (s) => onFrameStatsRef.current?.(s),
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
    controller.current?.setOverheadActive(overheadActive !== false);
  }, [overheadActive]);

  useEffect(() => {
    controller.current?.setDailyBox(dailyBox ?? null);
  }, [dailyBox]);

  useEffect(() => {
    return () => {
      onControllerRef.current?.(null);
      controller.current?.dispose();
    };
  }, []);

  // Simulators stay on the lightweight fallback — expo-gl's software renderer
  // misbehaves there and a scene failure can take down unrelated app flows.
  if (!SCENE_3D_ENABLED) return <SceneFallback style={StyleSheet.flatten([styles.fill, style])} />;

  return (
    <View
      // NO_BROWSER_PAN: on web this drag orbits the camera, so the browser must
      // not also read it as a page pan/zoom
      style={[styles.fill, RENDER_SCALE === 1 ? null : styles.center, NO_BROWSER_PAN, style]}
      onLayout={(e) => {
        size.current = { w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 };
      }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => controller.current?.pointerDown(...toNdc(e))}
      onResponderMove={(e) => controller.current?.pointerMove(...toNdc(e))}
      onResponderRelease={(e) => controller.current?.pointerUp(...toNdc(e))}
      onResponderTerminate={(e) => controller.current?.pointerUp(...toNdc(e))}
    >
      {/* MSAA on real hardware; 0 on the simulator, whose MSAA resolve
          intermittently drops skinned draws. 2x (not 4x) on device: the 4x
          multisample resolve was a measurable per-frame GPU cost during the
          big camera moves, and 2x is nearly indistinguishable on a retina
          panel while roughly halving that resolve bandwidth. */}
      <GLView
        style={RENDER_SCALE === 1 ? styles.fill : styles.scaled}
        pointerEvents="none"
        msaaSamples={Device.isDevice ? 2 : 0}
        onContextCreate={onContextCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  // undersized + scaled about its center, so it exactly fills the wrapper
  scaled: {
    width: `${RENDER_SCALE * 100}%`,
    height: `${RENDER_SCALE * 100}%`,
    transform: [{ scale: 1 / RENDER_SCALE }],
  },
});
