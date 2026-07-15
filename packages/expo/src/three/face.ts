import * as THREE from 'three';

// Ported verbatim from sidekick/src/components/sidekick-face.ts (minus the
// URL-based loadFaceTexture — the texture is loaded via expo-asset in assets.ts
// and configured here). The GLB's "FaceSprite" plane samples one cell of a 4×4
// expression sheet; this controller drives blink/talk/expression pulses.

const GRID = 4;

// name → [col, row]; keep in sync with face-sheet-v6.png
export const FACE_CELLS = {
  neutral: [0, 0],
  blink: [2, 0],
  happy: [2, 0],
  excited: [3, 0],
  cheer: [0, 1],
  sad: [1, 1],
  sleepy: [2, 1],
  thinking: [3, 1],
  surprised: [0, 2],
  wink: [1, 2],
  talkOpen: [2, 2],
  talkClosed: [3, 2],
} as const;
export type FaceExpression = keyof typeof FACE_CELLS;
export const FACE_EXPRESSIONS = Object.keys(FACE_CELLS) as FaceExpression[];

// Configure an already-loaded texture for cell sampling (glTF UV convention).
export function configureFaceTexture(t: THREE.Texture): THREE.Texture {
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.repeat.set(1 / GRID, 1 / GRID);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export type FaceController = {
  set: (e: FaceExpression) => void;
  pulse: (e: FaceExpression, seconds: number) => void;
  setTalking: (on: boolean) => void;
  setBlinking: (on: boolean) => void;
  setScale: (sc: number) => void;
  setOffsetY: (dy: number) => void;
  update: (t: number) => void;
};

// Deterministic pseudo-random (Math.random works in RN, but keep blink cadence
// varied without seeding surprises across reloads).
function rand() {
  return Math.random();
}

export function createFaceController(tex: THREE.Texture, scale = 1, offsetY = 0): FaceController {
  let base: FaceExpression = 'neutral';
  let pulseExpr: FaceExpression | null = null;
  let pulseUntil = 0;
  let pulseSeconds = 0;
  let talking = false;
  let blinking = true;
  let nextBlink = 2 + rand() * 3;
  let blinkUntil = -1;
  let current: FaceExpression | null = null;

  const applyScale = (sc: number) => {
    scale = Math.max(0.9, sc);
    tex.repeat.setScalar(1 / (GRID * scale));
  };
  applyScale(scale);

  const show = (e: FaceExpression) => {
    if (e === current) return;
    current = e;
    const [c, r] = FACE_CELLS[e];
    const cell = 1 / GRID;
    const win = tex.repeat.y;
    const inset = (cell - win) / 2;
    const u = c * cell + inset;
    const v = r * cell + inset + offsetY * cell;
    tex.offset.set(u, v);
  };
  const reshow = () => {
    const e = current;
    current = null;
    if (e) show(e);
  };

  return {
    set: (e) => {
      base = e;
    },
    pulse: (e, seconds) => {
      pulseExpr = e;
      pulseUntil = -1;
      pulseSeconds = seconds;
    },
    setTalking: (on) => {
      talking = on;
    },
    setBlinking: (on) => {
      blinking = on;
    },
    setScale: (sc) => {
      applyScale(sc);
      reshow();
    },
    setOffsetY: (dy) => {
      offsetY = dy;
      reshow();
    },
    update: (t) => {
      if (pulseExpr && pulseUntil === -1) pulseUntil = t + pulseSeconds;
      if (pulseExpr && t > pulseUntil) pulseExpr = null;
      if (blinking && !talking && t >= nextBlink) {
        blinkUntil = t + 0.13;
        nextBlink = t + 2.5 + rand() * 3.5;
        if (rand() < 0.25) nextBlink = t + 0.35;
      }
      if (talking) {
        show(Math.floor(t * 8) % 2 === 0 ? 'talkOpen' : 'talkClosed');
      } else if (t < blinkUntil) {
        show('blink');
      } else {
        show(pulseExpr ?? base);
      }
    },
  };
}
