import Constants from "expo-constants";

/**
 * Real-device gate for the GL scene. Simulator rendering is intentionally kept
 * on the lightweight fallback because expo-gl uses a different software stack,
 * and a scene failure can take down unrelated app flows.
 *
 * EXPO_PUBLIC_DISABLE_3D=1 remains an escape hatch for working on the 2D app
 * on a physical device.
 * expo-gl on the simulator is a software renderer that behaves differently from
 * a real device — it is slow and it lies about extensions.
 *
 * EXPO_PUBLIC_* values are inlined at bundle time, so changing this needs a
 * Metro restart, not just a reload. Never verify the *scene itself* with this
 * on — and per the README, verify the scene on a physical device regardless.
 */
export const SCENE_3D_ENABLED =
  Constants.isDevice && process.env.EXPO_PUBLIC_DISABLE_3D !== "1";
