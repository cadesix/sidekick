import { BlurView, type BlurViewProps } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

// True on iOS 26+ only; false on older iOS, Android, and web.
const liquidGlass = isLiquidGlassAvailable();

interface GlassProps {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  // Fallback blur tuning (older iOS / Android native blur, web backdrop-filter).
  intensity?: number;
  tint?: BlurViewProps["tint"];
}

/**
 * Native iOS 26 liquid glass where it's available, a best-effort frosted blur
 * everywhere else. `expo-glass-effect`'s GlassView renders as a plain (opaque-less)
 * View off-iOS, so the fallback has to be explicit — `expo-blur` gives a real
 * `backdrop-filter` on web and a native blur on older iOS / Android.
 */
export function Glass({ style, children, intensity = 40, tint = "light" }: GlassProps) {
  if (liquidGlass) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={intensity} tint={tint} style={style}>
      {children}
    </BlurView>
  );
}
