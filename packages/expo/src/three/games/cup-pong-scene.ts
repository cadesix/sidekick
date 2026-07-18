import * as THREE from 'three';

import { cupPong, type CupPongFlick } from '@sidekick/core';

import { roundedRectShape, type GameSceneHost } from './game-scene';

// The Cup Pong scene (plan 21 §Cup Pong): all-procedural — a proper table (top
// slab + darker skirt over a floor plane, lengthwise white aiming line), solo
// cups in the engine's 4-3-2-1 triangle, a sphere ball flying the exact
// parabola core's throwFlight describes. The FAR rack is always the one being
// shot at (the driver swaps masks between the sidekick's replay and the user's
// turn); the near rack mirrors the other side's cups, small, GamePigeon-style.
// No landing pre-viz while aiming — GamePigeon gives you nothing but feel; the
// only cue is the ball nudging sideways with the drag (direction, never
// distance). Engine coords (x lateral, y downtable) map to world (x, -y).

export const CUP_PONG_FRAMING = {
  pos: [0, 2.5, 1.95] as [number, number, number],
  target: [0, -0.55, -1.15] as [number, number, number],
  fov: 46,
};
export const CUP_PONG_BACKGROUND = '#efe3cf';

const CUP_H = 0.14;
const CUP_MOUTH_R = 0.0445;
const BALL_R = 0.03;
const BALL_START = new THREE.Vector3(0, 0.24, 0.52);
const NEAR_RACK_Z = 0.52;
const NEAR_RACK_SCALE = 0.55;
const AIM_NUDGE = 0.06;

export type ThrowVisual = {
  /** far-rack slot the ball dropped into, or null on a miss */
  cupSlot: number | null;
  rimNearMiss: boolean;
  /** the far side's mask after this throw settled (incl. any re-rack) */
  farMaskAfter: number;
};

export type CupPongSceneController = {
  showRacks: (farMask: number, nearMask: number) => void;
  /** Direction-only aim cue: the ball leans with the drag. Null resets it. */
  setAimCue: (x: number | null) => void;
  animateThrow: (flick: CupPongFlick, visual: ThrowVisual) => Promise<void>;
  /** Skippable pause between replayed shots. */
  wait: (ms: number) => Promise<void>;
  /** Fast-forward: every pending and future animation completes instantly. */
  skip: () => void;
  clearSkip: () => void;
};

type Tween = {
  duration: number;
  elapsed: number;
  update: (t: number) => void;
  resolve: () => void;
};

function farPosition(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(x, 0, -y);
}

function nearPosition(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(
    x * NEAR_RACK_SCALE,
    0,
    NEAR_RACK_Z - (cupPong.RACK_BACK_Y - y) * NEAR_RACK_SCALE,
  );
}

export function createCupPongScene(host: GameSceneHost): CupPongSceneController {
  const { scene } = host;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), host.celMaterial('#bcab89'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.1;
  scene.add(floor);

  const tableTop = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(1.6, 3.4, 0.12), {
      depth: 0.06,
      bevelEnabled: false,
    }),
    host.celMaterial('#d9a566'),
  );
  tableTop.rotation.x = -Math.PI / 2;
  tableTop.position.set(0, -0.06, -0.95);
  scene.add(tableTop);

  const skirt = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(1.46, 3.26, 0.1), {
      depth: 0.26,
      bevelEnabled: false,
    }),
    host.celMaterial('#b3823f'),
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(0, -0.32, -0.95);
  scene.add(skirt);

  const lineMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.017, 3.24), lineMat);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.set(0, 0.002, -0.95);
  scene.add(centerLine);

  // Red-solo-cup lathe: pedestal foot, tapered body with two thin ridge rings,
  // rolled rim lip. Mouth stays under half the rack spacing so neighbours in
  // core's layout just kiss instead of clipping.
  const cupProfile = [
    new THREE.Vector2(0, 0.004),
    new THREE.Vector2(0.027, 0.004),
    new THREE.Vector2(0.029, 0),
    new THREE.Vector2(0.0305, 0.012),
    new THREE.Vector2(0.0315, 0.016),
    new THREE.Vector2(0.034, 0.048),
    new THREE.Vector2(0.0365, 0.076),
    new THREE.Vector2(0.038, 0.088),
    new THREE.Vector2(0.0372, 0.091),
    new THREE.Vector2(0.0388, 0.094),
    new THREE.Vector2(0.038, 0.097),
    new THREE.Vector2(0.0402, 0.104),
    new THREE.Vector2(0.043, 0.124),
    new THREE.Vector2(CUP_MOUTH_R, 0.134),
    new THREE.Vector2(CUP_MOUTH_R, CUP_H),
  ];
  const cupGeo = new THREE.LatheGeometry(cupProfile, 28);
  const rimGeo = new THREE.TorusGeometry(CUP_MOUTH_R, 0.0042, 10, 28);
  const mouthGeo = new THREE.CircleGeometry(0.0405, 24);
  const cupMat = host.celMaterial('#dd3f34');
  const rimMat = host.celMaterial('#ea5a50');
  const mouthMat = new THREE.MeshBasicMaterial({ color: '#821f17' });

  function makeCup(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(cupGeo, cupMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = CUP_H - 0.003;
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.y = CUP_H - 0.015;
    group.add(body, rim, mouth);
    return group;
  }

  const farRack = new THREE.Group();
  const nearRack = new THREE.Group();
  scene.add(farRack, nearRack);
  const farCups = new Map<number, THREE.Group>();

  function buildFarRack(mask: number): void {
    farRack.clear();
    farCups.clear();
    for (const cup of cupPong.cupPositions(mask)) {
      const mesh = makeCup();
      mesh.position.copy(farPosition(cup.x, cup.y));
      farRack.add(mesh);
      farCups.set(cup.slot, mesh);
    }
  }

  function buildNearRack(mask: number): void {
    nearRack.clear();
    for (const cup of cupPong.cupPositions(mask)) {
      const mesh = makeCup();
      mesh.position.copy(nearPosition(cup.x, cup.y));
      mesh.scale.setScalar(NEAR_RACK_SCALE);
      nearRack.add(mesh);
    }
  }

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 20, 14),
    host.celMaterial('#fdfaf2'),
  );
  ball.position.copy(BALL_START);
  scene.add(ball);

  const ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_R * 1.1, 20),
    new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);
  const ballShadowMat = ballShadow.material;

  let tweens: Tween[] = [];
  let fastForward = false;

  host.onFrame((dt) => {
    ballShadow.visible = ball.visible && ball.position.y < 0.9;
    ballShadow.position.set(ball.position.x, 0.003, ball.position.z);
    const squash = 1 / (1 + ball.position.y * 1.6);
    ballShadow.scale.setScalar(Math.max(squash, 0.3) * ball.scale.x);
    ballShadowMat.opacity = 0.16 * squash;
    if (tweens.length === 0) return;
    const finished: Tween[] = [];
    for (const tween of tweens) {
      tween.elapsed += dt;
      const t = Math.min(tween.elapsed / tween.duration, 1);
      tween.update(t);
      if (t >= 1) finished.push(tween);
    }
    tweens = tweens.filter((tween) => !finished.includes(tween));
    for (const tween of finished) tween.resolve();
  });

  function play(duration: number, update: (t: number) => void): Promise<void> {
    if (fastForward) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      tweens.push({ duration, elapsed: 0, update, resolve });
    });
  }

  function popCup(slot: number): Promise<void> {
    const cup = farCups.get(slot);
    if (!cup) return Promise.resolve();
    return play(0.28, (t) => {
      const scale = t < 0.35 ? 1 + 0.35 * (t / 0.35) : Math.max(1.35 * (1 - (t - 0.35) / 0.65), 0.001);
      cup.scale.setScalar(scale);
    });
  }

  function wobbleNearest(landing: { x: number; y: number }, mask: number): Promise<void> {
    let nearest: { d: number; slot: number } | null = null;
    for (const cup of cupPong.cupPositions(mask)) {
      const d = Math.hypot(landing.x - cup.x, landing.y - cup.y);
      if (nearest === null || d < nearest.d) nearest = { d, slot: cup.slot };
    }
    const cup = nearest === null ? undefined : farCups.get(nearest.slot);
    if (!cup) return Promise.resolve();
    return play(0.45, (t) => {
      cup.rotation.z = 0.22 * Math.sin(t * Math.PI * 4) * (1 - t);
    });
  }

  return {
    showRacks: (farMask, nearMask) => {
      buildFarRack(farMask);
      buildNearRack(nearMask);
      ball.visible = true;
      ball.scale.setScalar(1);
      ball.position.copy(BALL_START);
    },

    setAimCue: (x) => {
      ball.position.x = x === null ? BALL_START.x : x * AIM_NUDGE;
    },

    animateThrow: async (flick, visual) => {
      const flight = cupPong.throwFlight(flick);
      const hit = visual.cupSlot !== null;
      const start = new THREE.Vector3(ball.position.x, BALL_START.y, BALL_START.z);
      const end = farPosition(flight.landing.x, flight.landing.y);
      end.y = hit ? CUP_H + BALL_R : BALL_R;
      ball.visible = true;
      ball.scale.setScalar(1);
      ball.position.copy(start);

      await play(flight.duration, (t) => {
        ball.position.lerpVectors(start, end, t);
        ball.position.y =
          start.y + (end.y - start.y) * t + flight.apexHeight * 3.2 * t * (1 - t);
      });

      if (visual.cupSlot !== null) {
        const slot = visual.cupSlot;
        await play(0.12, (t) => {
          ball.position.y = end.y - t * CUP_H * 0.7;
          ball.scale.setScalar(1 - 0.6 * t);
        });
        ball.visible = false;
        await popCup(slot);
        buildFarRack(visual.farMaskAfter);
      } else {
        const wobble = visual.rimNearMiss
          ? wobbleNearest(flight.landing, visual.farMaskAfter)
          : Promise.resolve();
        const roll = play(0.3, (t) => {
          ball.position.z -= 0.012;
          ball.position.y = Math.max(BALL_R * (1 - t), 0.005);
          ball.scale.setScalar(1 - 0.85 * t);
        });
        await Promise.all([wobble, roll]);
        ball.visible = false;
      }
      ball.position.copy(BALL_START);
    },

    wait: (ms) => play(ms / 1000, () => {}),

    skip: () => {
      fastForward = true;
      const pending = tweens;
      tweens = [];
      for (const tween of pending) {
        tween.update(1);
        tween.resolve();
      }
    },

    clearSkip: () => {
      fastForward = false;
    },
  };
}
