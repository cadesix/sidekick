// Ported from sidekick/src/components/{sidekick-settings,sidekick-scene}.ts.
// The web app read look-dev state from localStorage (written by the /sidekick-3d
// editor). Mobile mirrors that: the in-app Settings sheet edits these values
// live and persists them to AsyncStorage under the SAME key as the web
// ("sidekick3d-settings-v2"); hydrateSettings() must resolve before the canvas
// mounts so the GL scene builds from the saved state synchronously.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type TimeOfDay = 'day' | 'evening' | 'night';

export type ScenePreset = {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  grassHill: string;
  grassBase: string;
  grassTip: string;
  rock: string;
  charTint: string;
  shadeColor: string;
  keyColor: string;
  keyIntensity: number;
  fillColor: string;
  fillIntensity: number;
  rimColor: string;
  rimIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  exposure: number;
};

export const TIMES: TimeOfDay[] = ['day', 'evening', 'night'];

export const SCENE_DEFAULTS: Record<TimeOfDay, ScenePreset> = {
  day: {
    skyTop: '#3ea1cc',
    skyMid: '#6aa8e0',
    skyHorizon: '#dcecfb',
    fog: '#dcecfb',
    fogNear: 8,
    fogFar: 32.5,
    grassHill: '#c0d265',
    grassBase: '#519d2d',
    grassTip: '#93cf4f',
    rock: '#8b8f96',
    charTint: '#ffffff',
    shadeColor: '#c98f52',
    keyColor: '#fff4dc',
    keyIntensity: 1.5,
    fillColor: '#a9c9ff',
    fillIntensity: 0.5,
    rimColor: '#ffffff',
    rimIntensity: 1.0,
    hemiSky: '#dcefff',
    hemiGround: '#8a9560',
    hemiIntensity: 0.55,
    exposure: 0.92,
  },
  evening: {
    skyTop: '#40407a',
    skyMid: '#d18a72',
    skyHorizon: '#ffe0a0',
    fog: '#e8a877',
    fogNear: 0,
    fogFar: 76.5,
    grassHill: '#a69c36',
    grassBase: '#6fa13a',
    grassTip: '#b9c25e',
    rock: '#8a7a7e',
    charTint: '#f4bd8c',
    shadeColor: '#a86840',
    keyColor: '#ffb257',
    keyIntensity: 1.3,
    fillColor: '#5b6bc4',
    fillIntensity: 0.5,
    rimColor: '#ffe0a8',
    rimIntensity: 1.7,
    hemiSky: '#ffcf9a',
    hemiGround: '#3a3560',
    hemiIntensity: 0.5,
    exposure: 0.86,
  },
  night: {
    skyTop: '#0c0a29',
    skyMid: '#2c1a47',
    skyHorizon: '#5b407d',
    fog: '#26355c',
    fogNear: 0,
    fogFar: 12,
    grassHill: '#424601',
    grassBase: '#274115',
    grassTip: '#235421',
    rock: '#3a4358',
    charTint: '#7e8ec2',
    shadeColor: '#3a4a70',
    keyColor: '#aebfe6',
    keyIntensity: 0.65,
    fillColor: '#3a4a80',
    fillIntensity: 0.4,
    rimColor: '#cdd8f5',
    rimIntensity: 0.8,
    hemiSky: '#2a3a66',
    hemiGround: '#0f1529',
    hemiIntensity: 0.36,
    exposure: 2,
  },
};

export type ShadingMode =
  | 'physical'
  | 'toon'
  | 'ramp'
  | 'gooch'
  | 'halftone'
  | 'sss'
  | 'matcap'
  | 'cel';

export type SidekickSettings = {
  shading: ShadingMode;
  toonBands: number;
  toonSoftness: number;
  toonSpecStrength: number;
  toonSpecSize: number;
  toonRimStrength: number;
  toonShadowColor: string;
  toonShadowAmt: number;
  rampMid: string;
  rampLight: string;
  celBodyColor: string;
  celShadowColor: string;
  celSoftness: number;
  celShadowAmt: number;
  goochCool: string;
  goochWarm: string;
  halftoneScale: number;
  sssColor: string;
  sssStrength: number;
  outline: boolean;
  outlineWidth: number;
  outlineColor: string;
  faceZoom: number;
  faceHeight: number;
  shirtEnabled: boolean;
  shirtColor: string;
  poseArmDown: number;
  poseArmTwist: number;
  poseRollSplit: number;
  poseArmForward: number;
  poseForeBend: number;
  timeOfDay: TimeOfDay;
  scenes: Record<TimeOfDay, ScenePreset>;
  skyTop: string;
  skyHorizon: string;
  grassHill: string;
  grassBase: string;
  grassTip: string;
  grassHeight: number;
  grassClumping: number;
  tint: string;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  emissiveColor: string;
  emissiveIntensity: number;
  exposure: number;
  envIntensity: number;
  keyIntensity: number;
  keyColor: string;
  fillIntensity: number;
  fillColor: string;
  rimIntensity: number;
  rimColor: string;
  hemiIntensity: number;
  // bloom (UnrealBloomPass on an 8-bit composer chain — expo-gl has no float RTs)
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  shadowOpacity: number;
  fov: number;
  camPos: [number, number, number] | null;
  camTarget: [number, number, number] | null;
};

// Baked 2026-07-10 from the user's LIVE browser look-dev state
// (localStorage "sidekick3d-settings-v2" — the approved look), NOT the web
// repo's DEFAULT_SETTINGS, which lag the tuned state (outline, cel shadow,
// face placement, grass height/clumping and scene colors all differ).
export const DEFAULT_SETTINGS: SidekickSettings = {
  shading: 'cel',
  toonBands: 2,
  toonSoftness: 0.323,
  toonSpecStrength: 0,
  toonSpecSize: 0.132,
  toonRimStrength: 0.348,
  toonShadowColor: '#cc8d05',
  toonShadowAmt: 0.506,
  rampMid: '#ffb061',
  rampLight: '#ffedc4',
  celBodyColor: '#ffbb29',
  celShadowColor: '#c98f52',
  celSoftness: 0,
  celShadowAmt: 0.501,
  goochCool: '#7a86b8',
  goochWarm: '#fff1d6',
  halftoneScale: 7.432,
  sssColor: '#ce7036',
  sssStrength: 0.552,
  outline: false,
  outlineWidth: 0.00722,
  outlineColor: '#b77d1a',
  faceZoom: 0.9,
  faceHeight: 0.185,
  shirtEnabled: true,
  shirtColor: '#5c8ad6',
  poseArmDown: 1.29,
  poseArmTwist: 1.08,
  poseRollSplit: 0.08,
  poseArmForward: 0.25,
  poseForeBend: -0.13,
  timeOfDay: 'evening',
  scenes: SCENE_DEFAULTS,
  skyTop: '#3f86cc',
  skyHorizon: '#dcecfb',
  grassHill: '#5aa838',
  grassBase: '#519d2d',
  grassTip: '#93cf4f',
  grassHeight: 1.18,
  grassClumping: 1,
  tint: '#ffffff',
  roughness: 1,
  clearcoat: 0,
  clearcoatRoughness: 0,
  sheen: 0,
  sheenRoughness: 0,
  sheenColor: '#ffb36b',
  emissiveColor: '#767323',
  emissiveIntensity: 0.08,
  exposure: 0.7896,
  envIntensity: 0.891,
  keyIntensity: 1.5,
  keyColor: '#fff4dc',
  fillIntensity: 0.5,
  fillColor: '#a9c9ff',
  rimIntensity: 1.0,
  rimColor: '#ffffff',
  hemiIntensity: 0.55,
  // bloom values from the user's tuned look-dev state
  bloomEnabled: true,
  bloomStrength: 0.158,
  bloomRadius: 0.3885,
  bloomThreshold: 0.615,
  // NOTE: web home4 drives a real shadow map with this; mobile has no shadow
  // map yet (expo-gl risk), so the value is carried but inert
  shadowOpacity: 0.2316,
  fov: 19.455,
  camPos: [-0.8622328104178634, 0.8720766906255945, 5.542186848594252],
  camTarget: [0, 0.7, 0],
};

// same key as the web look-dev editor's localStorage entry
export const SETTINGS_KEY = 'sidekick3d-settings-v2';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// in-memory copy the renderer reads synchronously at context creation;
// hydrateSettings() replaces it from AsyncStorage before the canvas mounts
let current: SidekickSettings = clone(DEFAULT_SETTINGS);

export function loadSettings(): SidekickSettings {
  return clone(current);
}

export async function hydrateSettings(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<SidekickSettings>;
    const merged = { ...clone(DEFAULT_SETTINGS), ...saved };
    // deep-merge the scene presets so newly-added preset fields survive an
    // older saved `scenes` object (shallow spread would drop them)
    const savedScenes = saved.scenes as
      | Partial<Record<TimeOfDay, Partial<ScenePreset>>>
      | undefined;
    merged.scenes = {
      day: { ...SCENE_DEFAULTS.day, ...savedScenes?.day },
      evening: { ...SCENE_DEFAULTS.evening, ...savedScenes?.evening },
      night: { ...SCENE_DEFAULTS.night, ...savedScenes?.night },
    };
    current = merged;
  } catch {
    // unreadable saved state — keep defaults
  }
}

export function saveSettings(s: SidekickSettings): void {
  current = clone(s);
  AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current)).catch(() => {});
}

export function resetSettings(): SidekickSettings {
  current = clone(DEFAULT_SETTINGS);
  AsyncStorage.removeItem(SETTINGS_KEY).catch(() => {});
  return clone(current);
}
