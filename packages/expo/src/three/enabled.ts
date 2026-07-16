/**
 * Gate for the GL scene. 3D renders everywhere (device, simulator, Expo Web) by
 * default; set EXPO_PUBLIC_DISABLE_3D=1 to force the lightweight 2D fallback when
 * working on the 2D app.
 *
 * Caveat: expo-gl on the simulator is a software renderer that behaves
 * differently from a real device — it is slow and it lies about extensions, so
 * per the README verify the scene itself on a physical device regardless.
 *
 * EXPO_PUBLIC_* values are inlined at bundle time, so changing this needs a
 * Metro restart, not just a reload.
 */
export const SCENE_3D_ENABLED = process.env.EXPO_PUBLIC_DISABLE_3D !== "1";
