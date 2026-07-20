import { Renderer } from 'expo-three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';

import { loadSettings, type SidekickSettings } from '../settings';
import { makeCelMaterial } from '../shading';

// Shared harness for the mini-game scenes (plan 21 §The game overlay): the
// renderer loop, a fixed portrait camera and the app's cel materials, so a game
// scene (cup-pong-scene.ts, and pool-scene.ts in phase 4) is just meshes + a
// per-frame tick. Same imperative recipe as renderer.ts — expo-gl context in,
// controller out, gl.endFrameEXP() per frame — minus the character plumbing.

export type GameFraming = {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
};

/** Centered rounded-rect outline in the XY plane (table tops, skirts). */
export function roundedRectShape(w: number, l: number, r: number): THREE.Shape {
  const hw = w / 2;
  const hl = l / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hl);
  shape.lineTo(hw - r, -hl);
  shape.absarc(hw - r, -hl + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hl - r);
  shape.absarc(hw - r, hl - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hl);
  shape.absarc(-hw + r, hl - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hl + r);
  shape.absarc(-hw + r, -hl + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}

export type GameSceneHost = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Flat-color cel material matching the app look (lights-free shader). */
  celMaterial: (color: string) => THREE.ShaderMaterial;
  /** Per-frame tick, called before render. Returns an unsubscribe. */
  onFrame: (cb: (dt: number) => void) => () => void;
  dispose: () => void;
};

export function createGameScene(
  gl: ExpoWebGLRenderingContext,
  opts: { background: string; framing: GameFraming },
): GameSceneHost {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;

  // Games always render the bright daytime look, whatever the meadow's clock —
  // the overlay is its own space, not part of the world outside.
  const settings: SidekickSettings = { ...loadSettings(), timeOfDay: 'day' };
  const sc = settings.scenes[settings.timeOfDay];

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background);

  const camera = new THREE.PerspectiveCamera(opts.framing.fov, width / height, 0.05, 50);
  camera.position.fromArray(opts.framing.pos);
  camera.lookAt(new THREE.Vector3().fromArray(opts.framing.target));

  const renderer: THREE.WebGLRenderer = new Renderer({ gl });
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = sc.exposure;

  const callbacks = new Set<(dt: number) => void>();
  const clock = new THREE.Clock();
  let disposed = false;
  let raf = 0;

  const animate = () => {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    for (const cb of callbacks) cb(dt);
    renderer.render(scene, camera);
    gl.endFrameEXP();
  };
  animate();

  return {
    scene,
    camera,
    celMaterial: (color: string) =>
      makeCelMaterial(settings, { map: null, normalMap: null, vertexColors: false }, color),
    onFrame: (cb) => {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      callbacks.clear();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const material: THREE.Material | THREE.Material[] = obj.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
    },
  };
}
