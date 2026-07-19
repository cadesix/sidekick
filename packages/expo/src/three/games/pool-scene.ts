import * as THREE from 'three';

import { eightBall, type EightBallState } from '@sidekick/core';

import { roundedRectShape, type GameFraming, type GameSceneHost } from './game-scene';

// The 8 Ball scene (plan 21 §8 Ball): all-procedural — a real table build:
// rounded wood rail frame and felt cut as THREE.Shapes with the six pocket
// openings carved out as arcs of core's exact capture circles (dark slab
// beneath, so balls drop into holes), cushion segments straight from core's
// table geometry, 16 spheres (stripes are a white sphere with an equatorial
// color band — no textures), a cue stick and the GamePigeon aim guide
// (cue→ghost line, object stub, ✕ when the first contact is illegal). The
// scene renders whatever the engine says: live shots and replays both drive it
// by stepping createShotSim. Engine coords (x across, y downtable from the
// head end) map to world (x-½, ballY, 1-y) so the cue ball starts near the
// camera at the bottom.

export const POOL_FRAMING: GameFraming = {
  pos: [0, 3.85, 0.62],
  target: [0, 0, 0.02],
  fov: 44,
};
export const POOL_BACKGROUND = '#e9e0cd';

const { TABLE_W, TABLE_L, BALL_R, POCKET_R, POCKETS, CUSHIONS, SIM_DT } = eightBall;

const BALL_Y = BALL_R;
const CUSH_D = 0.03;
const CUSH_H = 0.04;
const RAIL_W = 0.1;
const RAIL_H = 0.05;
const CUE_LEN = 0.9;
const CUE_GAP = BALL_R + 0.035;
const MAX_PULL = 0.24;
const STUB_LEN = 0.13;
const GUIDE_Y = 0.004;
const LIFT_Y = BALL_R + 0.055;

export const POOL_BALL_COLORS: Record<number, string> = {
  1: '#f0b429',
  2: '#2456c4',
  3: '#d43a2f',
  4: '#6a3ba0',
  5: '#e8762c',
  6: '#1e8a4c',
  7: '#8c3b2e',
  8: '#26262b',
};

export type PoolAim = { state: EightBallState; dir: { x: number; y: number } };

export type PoolSceneController = {
  /** Snap the resting balls (index = ball id; pocketed balls hide). */
  setBalls: (balls: readonly { x: number; y: number; pocketed: boolean }[]) => void;
  /** Aim guide + cue stick from the aim state's cue ball; null hides both. */
  setAim: (aim: PoolAim | null) => void;
  /** Cue pull-back amount, 0..1 (the power track renders into the scene). */
  setPull: (pull: number) => void;
  /** Ball-in-hand hover: cue ball lifted at a spot, ringed by legality. */
  setCueLift: (lift: { x: number; y: number; legal: boolean } | null) => void;
  /** Replay presentation: the aim line sweeps to the shot direction. */
  sweepAim: (aim: PoolAim, duration: number) => Promise<void>;
  /** Step the engine sim at its fixed 120Hz rate, rendering every frame. */
  animateShot: (sim: eightBall.EightBallShotSim) => Promise<void>;
  /** Table point under a normalized (0..1) screen position. */
  tableFromScreen: (nx: number, ny: number) => { x: number; y: number };
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

function worldPoint(x: number, y: number, height: number): THREE.Vector3 {
  return new THREE.Vector3(x - TABLE_W / 2, height, TABLE_L / 2 - y);
}

// The playfield outline with the six pocket circles traced into it, in centered
// table coords ((0,0) = table middle, y downtable = shape +y). Walked CCW; at
// each pocket the boundary detours along core's exact capture circle — inward
// (`outward: false`) it hugs the arc inside the field (the felt edge), outward
// it bulges around the circle (the rail's inner cutout). Both share the same
// entry/exit points, so felt + rails leave precisely the capture circles open.
function outlineWithPockets(inflate: number, outward: boolean): THREE.Vector2[] {
  const w = TABLE_W / 2 + inflate;
  const l = TABLE_L / 2 + inflate;
  const pts: THREE.Vector2[] = [];
  const push = (x: number, y: number) => pts.push(new THREE.Vector2(x, y));
  const arc = (cx: number, cy: number, entry: [number, number], exit: [number, number]) => {
    const a1 = Math.atan2(entry[1] - cy, entry[0] - cx);
    let a2 = Math.atan2(exit[1] - cy, exit[0] - cx);
    if (outward) {
      while (a2 <= a1) a2 += Math.PI * 2;
    } else {
      while (a2 >= a1) a2 -= Math.PI * 2;
    }
    const steps = Math.max(8, Math.ceil((Math.abs(a2 - a1) / Math.PI) * 18));
    for (let i = 0; i <= steps; i++) {
      const a = a1 + ((a2 - a1) * i) / steps;
      push(cx + POCKET_R * Math.cos(a), cy + POCKET_R * Math.sin(a));
    }
  };
  const corner = POCKETS[0]!;
  const side = POCKETS[2]!;
  const cx = TABLE_W / 2 - corner.x;
  const cy = TABLE_L / 2 - corner.y;
  const sx = TABLE_W / 2 - side.x;
  const cd = Math.sqrt(POCKET_R * POCKET_R - (cx - w) * (cx - w));
  const sd = Math.sqrt(POCKET_R * POCKET_R - (sx - w) * (sx - w));

  push(-cx + cd, -l);
  push(cx - cd, -l);
  arc(cx, -cy, [cx - cd, -l], [w, -cy + cd]);
  push(w, -sd);
  arc(sx, 0, [w, -sd], [w, sd]);
  push(w, cy - cd);
  arc(cx, cy, [w, cy - cd], [cx - cd, l]);
  push(-cx + cd, l);
  arc(-cx, cy, [-cx + cd, l], [-w, cy - cd]);
  push(-w, sd);
  arc(-sx, 0, [-w, sd], [-w, -sd]);
  push(-w, -cy + cd);
  arc(-cx, -cy, [-w, -cy + cd], [-cx + cd, -l]);
  return pts;
}

/** First ball the cue ray hits (ghost-ball test) or the cushion point past it. */
function aimTrace(
  state: EightBallState,
  cue: { x: number; y: number },
  dir: { x: number; y: number },
): { end: { x: number; y: number }; targetId: number | null } {
  let bestT = Infinity;
  let targetId: number | null = null;
  for (let id = 1; id < 16; id++) {
    const b = state.balls[id]!;
    if (b.pocketed) continue;
    const ex = b.x - cue.x;
    const ey = b.y - cue.y;
    const proj = ex * dir.x + ey * dir.y;
    if (proj <= 0) continue;
    const perp2 = ex * ex + ey * ey - proj * proj;
    const r = BALL_R * 2;
    if (perp2 >= r * r) continue;
    const t = proj - Math.sqrt(r * r - perp2);
    if (t > 0 && t < bestT) {
      bestT = t;
      targetId = id;
    }
  }
  if (targetId === null) {
    bestT = Infinity;
    if (dir.x > 1e-6) bestT = Math.min(bestT, (TABLE_W - BALL_R - cue.x) / dir.x);
    if (dir.x < -1e-6) bestT = Math.min(bestT, (BALL_R - cue.x) / dir.x);
    if (dir.y > 1e-6) bestT = Math.min(bestT, (TABLE_L - BALL_R - cue.y) / dir.y);
    if (dir.y < -1e-6) bestT = Math.min(bestT, (BALL_R - cue.y) / dir.y);
    if (!Number.isFinite(bestT)) bestT = 0;
  }
  return { end: { x: cue.x + dir.x * bestT, y: cue.y + dir.y * bestT }, targetId };
}

export function createPoolScene(host: GameSceneHost): PoolSceneController {
  const { scene, camera } = host;

  const frameW = TABLE_W + (CUSH_D + RAIL_W) * 2;
  const frameL = TABLE_L + (CUSH_D + RAIL_W) * 2;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), host.celMaterial('#d8c8a8'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  scene.add(floor);

  const skirt = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(frameW - 0.06, frameL - 0.06, 0.08), {
      depth: 0.18,
      bevelEnabled: false,
    }),
    host.celMaterial('#6e4526'),
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.24;
  scene.add(skirt);

  // Pocket interiors: a dark slab right under the felt — anything through an
  // opening reads as a hole, not paint.
  const pit = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(frameW, frameL, 0.1), {
      depth: 0.05,
      bevelEnabled: false,
    }),
    new THREE.MeshBasicMaterial({ color: '#12100c' }),
  );
  pit.rotation.x = -Math.PI / 2;
  pit.position.y = -0.06;
  scene.add(pit);

  const feltShape = new THREE.Shape(outlineWithPockets(CUSH_D, false));
  const felt = new THREE.Mesh(new THREE.ShapeGeometry(feltShape, 8), host.celMaterial('#3aa062'));
  felt.rotation.x = -Math.PI / 2;
  scene.add(felt);

  const railShape = roundedRectShape(frameW, frameL, 0.1);
  const railHole = new THREE.Path();
  railHole.setFromPoints(outlineWithPockets(CUSH_D, true));
  railHole.closePath();
  railShape.holes.push(railHole);
  const rails = new THREE.Mesh(
    new THREE.ExtrudeGeometry(railShape, { depth: RAIL_H, bevelEnabled: false }),
    [host.celMaterial('#8a5a34'), host.celMaterial('#754a28')],
  );
  rails.rotation.x = -Math.PI / 2;
  scene.add(rails);

  // Cushions: extruded trapezoids — the nose runs exactly along core's cushion
  // segment, and the back edge extends toward each pocket so the ends read as
  // the angled jaws of a real cushion, not sawn-off boxes.
  const cushionMat = host.celMaterial('#2e8551');
  for (const seg of CUSHIONS) {
    const dx = Math.abs(seg.x2 - seg.x1);
    const dy = Math.abs(seg.y2 - seg.y1);
    const len = Math.max(dx, dy);
    const shape = new THREE.Shape();
    shape.moveTo(-len / 2, 0);
    shape.lineTo(len / 2, 0);
    shape.lineTo(len / 2 + CUSH_D * 0.85, CUSH_D);
    shape.lineTo(-len / 2 - CUSH_D * 0.85, CUSH_D);
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: CUSH_H, bevelEnabled: false }),
      cushionMat,
    );
    mesh.rotation.x = -Math.PI / 2;
    const group = new THREE.Group();
    group.add(mesh);
    if (dx > dy) {
      group.rotation.y = seg.y1 < 1 ? Math.PI : 0;
    } else {
      group.rotation.y = seg.x1 < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    }
    group.position.copy(worldPoint((seg.x1 + seg.x2) / 2, (seg.y1 + seg.y2) / 2, 0));
    scene.add(group);
  }

  // Pocket dressing: a dark rim ring flush with the rail top around each of
  // core's capture circles, so the openings read as leather-cupped pockets
  // instead of raw felt cutouts.
  const rimMat = host.celMaterial('#241a12');
  const rimGeo = new THREE.RingGeometry(POCKET_R - 0.004, POCKET_R + 0.022, 26);
  for (const pocket of POCKETS) {
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.copy(worldPoint(pocket.x, pocket.y, RAIL_H + 0.002));
    scene.add(rim);
  }

  // Rail sights: the six diamond dots per long rail (skipping the side
  // pocket), three per end rail, at the standard eighth positions.
  const sightMat = new THREE.MeshBasicMaterial({ color: '#e6d9bd' });
  const sightGeo = new THREE.CircleGeometry(0.0085, 12);
  const railMid = CUSH_D + RAIL_W / 2;
  const sights: { x: number; y: number }[] = [];
  for (const f of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) {
    sights.push({ x: -railMid, y: TABLE_L * f });
    sights.push({ x: TABLE_W + railMid, y: TABLE_L * f });
  }
  for (const f of [0.25, 0.5, 0.75]) {
    sights.push({ x: TABLE_W * f, y: -railMid });
    sights.push({ x: TABLE_W * f, y: TABLE_L + railMid });
  }
  for (const s of sights) {
    const dot = new THREE.Mesh(sightGeo, sightMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.copy(worldPoint(s.x, s.y, RAIL_H + 0.002));
    scene.add(dot);
  }

  const ballGeo = new THREE.SphereGeometry(BALL_R, 20, 14);
  const bandGeo = new THREE.SphereGeometry(BALL_R * 1.012, 20, 8, 0, Math.PI * 2, Math.PI / 2 - 0.55, 1.1);
  const shadowGeo = new THREE.CircleGeometry(BALL_R * 1.15, 18);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const whiteMat = host.celMaterial('#f6f2e8');
  const ballMeshes: THREE.Group[] = [];
  for (let id = 0; id < 16; id++) {
    const group = new THREE.Group();
    if (id === 0) {
      group.add(new THREE.Mesh(ballGeo, whiteMat));
    } else if (id <= 8) {
      group.add(new THREE.Mesh(ballGeo, host.celMaterial(POOL_BALL_COLORS[id]!)));
    } else {
      const base = new THREE.Mesh(ballGeo, whiteMat);
      const band = new THREE.Mesh(bandGeo, host.celMaterial(POOL_BALL_COLORS[id - 8]!));
      group.add(base, band);
    }
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -BALL_R + GUIDE_Y;
    group.add(shadow);
    scene.add(group);
    ballMeshes.push(group);
  }

  const liftRing = new THREE.Mesh(
    new THREE.TorusGeometry(BALL_R * 1.7, 0.005, 8, 26),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
  );
  liftRing.rotation.x = -Math.PI / 2;
  liftRing.visible = false;
  scene.add(liftRing);
  const liftRingMat = liftRing.material;

  const cueGroup = new THREE.Group();
  cueGroup.rotation.order = 'YXZ';
  cueGroup.rotation.x = -0.08;
  // The cue draws over rails and balls (GamePigeon-style): at a believable low
  // elevation it would otherwise bury into the rail whenever the ball sits
  // near a cushion, truncating the stick mid-shaft.
  const cueShaftMat = host.celMaterial('#caa05e');
  const cueTipMat = host.celMaterial('#5f7fb0');
  for (const mat of [cueShaftMat, cueTipMat]) mat.depthTest = false;
  const cueStick = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.0065, CUE_LEN, 12), cueShaftMat);
  cueStick.rotation.x = Math.PI / 2;
  cueStick.renderOrder = 4;
  const cueTip = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.02, 12), cueTipMat);
  cueTip.rotation.x = Math.PI / 2;
  cueTip.renderOrder = 4;
  cueGroup.add(cueStick, cueTip);
  cueGroup.visible = false;
  scene.add(cueGroup);

  const guideMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const crossMat = new THREE.MeshBasicMaterial({
    color: '#e0362b',
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const stripGeo = new THREE.PlaneGeometry(1, 1);
  const aimLine = new THREE.Mesh(stripGeo, guideMat);
  const stubLine = new THREE.Mesh(stripGeo, guideMat);
  const ghostRing = new THREE.Mesh(new THREE.TorusGeometry(BALL_R, 0.0045, 8, 26), guideMat);
  ghostRing.rotation.x = -Math.PI / 2;
  const cross = new THREE.Group();
  for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
    const arm = new THREE.Mesh(stripGeo, crossMat);
    arm.scale.set(0.055, 0.009, 1);
    arm.rotation.set(-Math.PI / 2, 0, tilt);
    cross.add(arm);
  }
  const aimGroup = new THREE.Group();
  aimGroup.add(aimLine, stubLine, ghostRing, cross);
  aimGroup.visible = false;
  scene.add(aimGroup);

  const yAxis = new THREE.Vector3(0, 1, 0);
  const spin = new THREE.Quaternion();

  function layStrip(
    mesh: THREE.Mesh,
    a: { x: number; y: number },
    b: { x: number; y: number },
    width: number,
  ): void {
    const wa = worldPoint(a.x, a.y, GUIDE_Y);
    const wb = worldPoint(b.x, b.y, GUIDE_Y);
    const len = wa.distanceTo(wb);
    mesh.visible = len > 1e-4;
    mesh.position.set((wa.x + wb.x) / 2, GUIDE_Y, (wa.z + wb.z) / 2);
    mesh.scale.set(Math.max(len, 1e-4), width, 1);
    mesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const angle = Math.atan2(-(wb.z - wa.z), wb.x - wa.x);
    mesh.quaternion.premultiply(spin.setFromAxisAngle(yAxis, angle));
  }

  let shownDir: { x: number; y: number } | null = null;
  let pull = 0;

  function updateCue(cue: { x: number; y: number }, dir: { x: number; y: number }): void {
    cueGroup.visible = true;
    cueGroup.position.copy(worldPoint(cue.x, cue.y, BALL_Y));
    cueGroup.rotation.y = Math.atan2(-dir.x, dir.y);
    const back = CUE_GAP + pull * MAX_PULL;
    cueStick.position.z = back + CUE_LEN / 2;
    cueTip.position.z = back - 0.01;
  }

  function renderAim(aim: PoolAim): void {
    const cue = { x: aim.state.balls[0]!.x, y: aim.state.balls[0]!.y };
    const dir = aim.dir;
    const trace = aimTrace(aim.state, cue, dir);
    aimGroup.visible = true;
    layStrip(aimLine, cue, trace.end, 0.009);
    if (trace.targetId !== null) {
      const ball = aim.state.balls[trace.targetId]!;
      const gp = worldPoint(trace.end.x, trace.end.y, GUIDE_Y);
      ghostRing.visible = true;
      ghostRing.position.set(gp.x, GUIDE_Y, gp.z);
      const ox = ball.x - trace.end.x;
      const oy = ball.y - trace.end.y;
      const om = Math.hypot(ox, oy);
      const stubEnd = {
        x: ball.x + (ox / om) * STUB_LEN,
        y: ball.y + (oy / om) * STUB_LEN,
      };
      layStrip(stubLine, { x: ball.x, y: ball.y }, stubEnd, 0.008);
      const legal = eightBall.legalTargets(aim.state).includes(trace.targetId);
      cross.visible = !legal;
      cross.position.set(gp.x, GUIDE_Y + 0.002, gp.z);
    } else {
      ghostRing.visible = false;
      stubLine.visible = false;
      cross.visible = false;
    }
    updateCue(cue, dir);
    shownDir = dir;
  }

  let tweens: Tween[] = [];
  let fastForward = false;
  let shotAnim: { sim: eightBall.EightBallShotSim; acc: number; resolve: () => void } | null = null;

  function syncSim(balls: readonly eightBall.EightBallSimBall[]): void {
    for (const b of balls) {
      const mesh = ballMeshes[b.id]!;
      mesh.visible = !b.pocketed;
      mesh.position.copy(worldPoint(b.x, b.y, BALL_Y));
    }
  }

  host.onFrame((dt) => {
    if (shotAnim) {
      shotAnim.acc += dt;
      let moving = true;
      while (shotAnim.acc >= SIM_DT && moving) {
        moving = shotAnim.sim.step();
        shotAnim.acc -= SIM_DT;
      }
      syncSim(shotAnim.sim.balls);
      if (!moving) {
        const { resolve } = shotAnim;
        shotAnim = null;
        resolve();
      }
    }
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

  return {
    setBalls: (balls) => {
      for (let id = 0; id < 16; id++) {
        const b = balls[id]!;
        const mesh = ballMeshes[id]!;
        mesh.visible = !b.pocketed;
        mesh.position.copy(worldPoint(b.x, b.y, BALL_Y));
      }
      liftRing.visible = false;
    },

    setAim: (aim) => {
      if (aim === null) {
        aimGroup.visible = false;
        cueGroup.visible = false;
        shownDir = null;
        return;
      }
      renderAim(aim);
    },

    setPull: (next) => {
      pull = Math.min(Math.max(next, 0), 1);
      if (cueGroup.visible && shownDir) {
        const p = cueGroup.position;
        updateCue({ x: p.x + TABLE_W / 2, y: TABLE_L / 2 - p.z }, shownDir);
      }
    },

    setCueLift: (lift) => {
      if (lift === null) {
        liftRing.visible = false;
        return;
      }
      const pos = worldPoint(lift.x, lift.y, LIFT_Y);
      ballMeshes[0]!.visible = true;
      ballMeshes[0]!.position.copy(pos);
      liftRing.visible = true;
      liftRing.position.set(pos.x, GUIDE_Y + 0.001, pos.z);
      liftRingMat.color.set(lift.legal ? '#ffffff' : '#e0362b');
    },

    sweepAim: (aim, duration) => {
      const target = Math.atan2(aim.dir.x, aim.dir.y);
      const fromDir = shownDir ?? {
        x: Math.sin(target + 0.7),
        y: Math.cos(target + 0.7),
      };
      const from = Math.atan2(fromDir.x, fromDir.y);
      let delta = target - from;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return play(duration, (t) => {
        const ease = t * t * (3 - 2 * t);
        const a = from + delta * ease;
        renderAim({ state: aim.state, dir: { x: Math.sin(a), y: Math.cos(a) } });
      });
    },

    animateShot: (sim) => {
      aimGroup.visible = false;
      cueGroup.visible = false;
      liftRing.visible = false;
      shownDir = null;
      pull = 0;
      if (fastForward) {
        while (sim.step());
        syncSim(sim.balls);
        return Promise.resolve();
      }
      syncSim(sim.balls);
      return new Promise((resolve) => {
        shotAnim = { sim, acc: 0, resolve };
      });
    },

    tableFromScreen: (nx, ny) => {
      const point = new THREE.Vector3(nx * 2 - 1, -(ny * 2 - 1), 0.5);
      point.unproject(camera);
      const ray = point.sub(camera.position).normalize();
      const t = (BALL_Y - camera.position.y) / ray.y;
      const hit = camera.position.clone().add(ray.multiplyScalar(t));
      return { x: hit.x + TABLE_W / 2, y: TABLE_L / 2 - hit.z };
    },

    wait: (ms) => play(ms / 1000, () => {}),

    skip: () => {
      fastForward = true;
      if (shotAnim) {
        const { sim, resolve } = shotAnim;
        shotAnim = null;
        while (sim.step());
        syncSim(sim.balls);
        resolve();
      }
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
