import { Platform } from "react-native";

/**
 * Gate for the GL scene. 3D renders everywhere (device, simulator, Expo Web) by
 * default; set EXPO_PUBLIC_DISABLE_3D=1 to force the lightweight 2D fallback.
 *
 * The flag only applies to native: browser WebGL is reliable, whereas expo-gl on
 * the iOS simulator is a software renderer that is slow and lies about
 * extensions (verify the scene on a physical device per the README). So Expo Web
 * keeps 3D even when the flag disables it on the crashy simulator.
 *
 * EXPO_PUBLIC_* values are inlined at bundle time, so changing this needs a
 * Metro restart, not just a reload.
 */
export const SCENE_3D_ENABLED =
  Platform.OS === "web" || process.env.EXPO_PUBLIC_DISABLE_3D !== "1";
