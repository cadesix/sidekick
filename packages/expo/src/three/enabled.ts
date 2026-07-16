import * as Device from "expo-device";

/**
 * Gate for the GL scene. 3D renders on real devices and on Expo Web (isDevice
 * is always true in a browser); simulators get the lightweight 2D fallback
 * automatically — expo-gl there is a software renderer that is slow, lies
 * about extensions, and a scene failure can take down unrelated app flows.
 * Verify anything 3D on a physical device per the README.
 */
export const SCENE_3D_ENABLED = Device.isDevice;
