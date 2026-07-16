import Constants from "expo-constants";
import { BlurView, type BlurViewProps } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { createElement, type ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

// True on iOS 26+ devices only. The simulator technically supports UIGlassEffect
// but draws it as an almost fully transparent wash — chrome like the composer or
// menus disappears entirely (re-verified 2026-07 with the createElement fix in
// place, so it is NOT the css-interop prop bug) — frosted-blur fallback instead.
const liquidGlass = isLiquidGlassAvailable() && isGlassEffectAPIAvailable() && Constants.isDevice;

interface GlassProps {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  // Only for tappable glass (round buttons) — matches UIKit's interactive glass.
  isInteractive?: boolean;
  // Fallback blur tuning (simulator, older iOS / Android native blur, web backdrop-filter).
  intensity?: number;
  tint?: BlurViewProps["tint"];
}

/**
 * Native iOS 26 liquid glass where it's available, a best-effort frosted blur
 * everywhere else. `expo-glass-effect`'s GlassView renders as a plain (opaque-less)
 * View off-iOS, so the fallback has to be explicit — `expo-blur` gives a real
 * `backdrop-filter` on web and a native blur on older iOS / Android.
 *
 * Never put `overflow: "hidden"` in `style`: clipping a UIGlassEffect view stops
 * the glass from rendering at all. GlassView respects `borderRadius` natively;
 * the BlurView fallback gets its clipping here.
 */
export function Glass({
  style,
  children,
  isInteractive = false,
  intensity = 100,
  tint = "systemThinMaterialLight",
}: GlassProps) {
  // createElement, not JSX: this file compiles with jsxImportSource "nativewind",
  // whose css-interop wrapper silently breaks GlassView's native props — the
  // effect never gets applied and the glass renders fully transparent.
  if (liquidGlass) {
    return createElement(GlassView, { glassEffectStyle: "regular", isInteractive, style }, children);
  }
  // The hairline rim stands in for liquid glass's specular edge, so the
  // fallback reads as glass rather than a flat frosted panel.
  return (
    <BlurView
      intensity={intensity}
      tint={tint}
      style={[
        style,
        {
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: "rgba(255,255,255,0.9)",
        },
      ]}
    >
      {children}
    </BlurView>
  );
}
