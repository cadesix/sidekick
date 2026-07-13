/**
 * Escape hatch for working on the 2D app (chat, shop, map) without the GL scene.
 * expo-gl on the simulator is a software renderer that behaves differently from
 * a real device — it is slow, it lies about extensions, and a scene crash takes
 * the whole app down with it. Set EXPO_PUBLIC_DISABLE_3D=1 to swap the canvas
 * for a static backdrop so nothing else is blocked by it.
 *
 * EXPO_PUBLIC_* values are inlined at bundle time, so changing this needs a
 * Metro restart, not just a reload. Never verify the *scene itself* with this
 * on — and per the README, verify the scene on a physical device regardless.
 */
export const SCENE_3D_ENABLED = process.env.EXPO_PUBLIC_DISABLE_3D !== "1";
