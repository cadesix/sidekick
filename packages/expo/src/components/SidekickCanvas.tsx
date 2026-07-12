import Constants from 'expo-constants';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type ViewStyle } from 'react-native';

import { createSidekickRenderer, type Framing, type SidekickController } from '../three/renderer';
import type { CosmeticsControls } from '../three/wardrobe';

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
  onControls,
  onController,
}: {
  style?: ViewStyle;
  framing: Framing;
  holdingPhone?: boolean;
  talking?: boolean;
  // Shop "studio": hide the meadow and show the character on a clean backdrop
  studio?: boolean;
  onControls?: (c: CosmeticsControls | null) => void;
  // the raw scene controller (Settings sheet uses applySettings for live look-dev)
  onController?: (c: SidekickController | null) => void;
}) {
  const controller = useRef<SidekickController | null>(null);
  // keep the latest callbacks without re-creating the GL scene
  const onControlsRef = useRef(onControls);
  onControlsRef.current = onControls;
  const onControllerRef = useRef(onController);
  onControllerRef.current = onController;
  const size = useRef({ w: 1, h: 1 });

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    controller.current = createSidekickRenderer(gl, {
      framing,
      holdingPhone,
      studio,
      onControls: (c) => onControlsRef.current?.(c),
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
    controller.current?.setStudio(!!studio);
  }, [studio]);

  useEffect(() => {
    return () => {
      onControllerRef.current?.(null);
      controller.current?.dispose();
    };
  }, []);

  return (
    <View
      style={[styles.fill, style]}
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
