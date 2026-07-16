import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// TEMPORARY look-dev knobs for the night sky's star constellation.
//
// Not shipped: SessionChat renders these as sliders in place of the chat when
// STAR_FACE_TUNING is on, so the sky can be dialled in live instead of edit →
// reload → wait out a camera pan. Once the numbers are agreed they get baked
// back into the constants in three/renderer.ts (and the counts in
// scripts/build-star-face.mjs) and this whole file goes away.
//
// Every change persists immediately, so a reload never loses a tuning session.
// The Save button is for the LAST mile: it prints the values as a paste-ready
// block for those constants, which is the only way they leave this store.
//
// Only RUNTIME values live here. Star counts, jitter and the traced contours are
// baked into star-face.json by the build script and can't move without re-running it.

export type StarFaceConfig = {
  lineAlpha: number; // how loud the joins are
  dustWeight: number; // dust brightness vs a contour star
  starSize: number; // point-size multiplier
  shineSpeed: number; // rad/sec of the travelling shine
  shineDepth: number; // how far the shine swings brightness (0 = steady)
  size: number; // world units across
  height: number; // world Y of the constellation
  depth: number; // world Z (more negative = further away)
  pitch: number; // radians, tilt toward the camera
  pulseAmt: number; // how far the slow breath rocks pitch (radians)
  pulseDepth: number; // how far it drifts in/out (world units)
  pulseHz: number; // breaths per second — very slow by design
};

// the values currently baked into renderer.ts — sliders start here
export const STAR_FACE_DEFAULTS: StarFaceConfig = {
  lineAlpha: 0.323,
  dustWeight: 0.571,
  starSize: 1.251,
  shineSpeed: 1.379,
  shineDepth: 0.45,
  size: 14.08,
  height: 29.82,
  depth: -29,
  pitch: Math.atan2(7.4, 15),
  pulseAmt: 0.035,
  pulseDepth: 0.9,
  pulseHz: 0.05,
};

const KEYS = Object.keys(STAR_FACE_DEFAULTS) as (keyof StarFaceConfig)[];

type Store = StarFaceConfig & {
  set: <K extends keyof StarFaceConfig>(k: K, v: StarFaceConfig[K]) => void;
  reset: () => void;
};

export const useStarFaceConfig = create<Store>()(
  persist(
    (set) => ({
      ...STAR_FACE_DEFAULTS,
      set: (k, v) => set({ [k]: v } as Pick<StarFaceConfig, typeof k>),
      reset: () => set({ ...STAR_FACE_DEFAULTS }),
    }),
    {
      name: 'sidekick_star_face_tuning',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) =>
        Object.fromEntries(KEYS.map((k) => [k, st[k]])) as unknown as StarFaceConfig,
    },
  ),
);

// A paste-ready block for three/renderer.ts, so a tuning session can actually
// land in the code rather than living in device storage forever.
export function starFaceSnippet(c: StarFaceConfig): string {
  const n = (v: number, d = 3) => Number(v.toFixed(d));
  return [
    '// star face — tuned values (scripts/build-star-face.mjs owns star COUNTS)',
    `const STAR_HEAD_AT = new THREE.Vector3(0, ${n(c.height, 2)}, ${n(c.depth, 2)});`,
    `const STAR_HEAD_SIZE = ${n(c.size, 2)};`,
    `const STAR_HEAD_PITCH = ${n(c.pitch)};`,
    `const STAR_LINE_ALPHA = ${n(c.lineAlpha)};`,
    `const STAR_DUST_WEIGHT = ${n(c.dustWeight)};`,
    `const STAR_SIZE = ${n(c.starSize)};`,
    `const STAR_SHINE_SPEED = ${n(c.shineSpeed)};`,
    `const STAR_SHINE_DEPTH = ${n(c.shineDepth)};`,
    `const STAR_PULSE_AMT = ${n(c.pulseAmt)};`,
    `const STAR_PULSE_DEPTH = ${n(c.pulseDepth)};`,
    `const STAR_PULSE_HZ = ${n(c.pulseHz)};`,
  ].join('\n');
}
