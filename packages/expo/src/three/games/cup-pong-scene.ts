import * as THREE from 'three';

import { cupPong, type CupPongFlick } from '@sidekick/core';

import { roundedRectShape, type GameFraming, type GameSceneHost } from './game-scene';

// The Cup Pong scene, staged like GamePigeon's: a green table with white lines
// on a wood floor, ONE rack in frame — whichever rack is being thrown at — and
// a camera standing at the table's end at chest height, so the view has real
// perspective: your ball is big at your feet and visibly shrinks as it flies
// down-table toward the small far rack (throw view), and the mirror of that
// watches the sidekick's ball arc in toward your own near red cups (receive
// view). Cups sit exactly on core's cupPositions and every ball flies a true
// ballistic parabola into core's throwFlight landing point, so server-replayed
// turns land where the engine says. All motion after launch — table bounces,
// rim deflections, the sink "plunk" — is one continuous path under a single
// gravity constant, with velocity carried through every contact (restitution
// vertically, damping horizontally), so nothing eases, floats, or teleports.
// Engine coords (x lateral, y downtable) map to world (x, -y).

type StageView = 'throw' | 'receive';

type ViewSpec = {
  framing: GameFraming;
  tableFarZ: number;
  tableNearZ: number;
};

const VIEWS: Record<StageView, ViewSpec> = {
  throw: {
    framing: { pos: [0, 0.85, 1.35], target: [0, 0, -1.5], fov: 50 },
    tableFarZ: -2.0,
    tableNearZ: 0.6,
  },
  receive: {
    framing: { pos: [0, 0.92, -3.15], target: [0, 0.06, -0.85], fov: 50 },
    tableFarZ: -2.32,
    tableNearZ: 0.28,
  },
};

export const CUP_PONG_FRAMING: GameFraming = VIEWS.throw.framing;
export const CUP_PONG_BACKGROUND = '#d9b285';

// Racked cups must never interpenetrate: core's tightest neighbour pair is
// CUP_SPACING (0.1) apart, so the rendered rim's outer radius stays under
// half that with a visible gap, and the visual mouth stays inside
// CUP_R + RIM_TOL so rim misses read as rim hits, never as sunk balls.
const CUP_H = 0.14;
const CUP_MOUTH_R = 0.0445;
const CUP_SCALE = 0.97;
const RIM_Y = CUP_H * CUP_SCALE;
// Real beer-pong proportions: 20mm ball vs 48mm cup mouth.
const BALL_R = 0.02;
const BALL_REST = new THREE.Vector3(0, BALL_R, 0);
const TABLE_W = 1.15;
const TABLE_LEN = 2.6;
const TABLE_H = 0.7;
const AIM_NUDGE = 0.09;
const CUP_BLOCK_R = 0.065;

// One gravity constant drives every arc, bounce and drop. Tuned so a full-
// power throw flies ~1.1s with an apex that stays inside the framing; bounce
// heights and durations then follow from physics, never from authored timing.
const G = 5.0;
const TABLE_E = 0.62;
const H_DAMP = 0.75;
const ROLL_K = 4.5;
const FLIGHT_SCALE = 0.85;

export type ThrowVisual = {
  /** rack slot the ball dropped into, or null on a miss */
  cupSlot: number | null;
  rimNearMiss: boolean;
  /** the target side's mask after this throw settled (incl. any re-rack) */
  targetMaskAfter: number;
};

export type CupPongSceneController = {
  /** Rebuild the scene for a turn: whose-eye view + the rack being shot at. */
  stage: (view: StageView, targetMask: number) => void;
  /** Spare-ball indicator on the table, GamePigeon style. */
  setBallsLeft: (n: number) => void;
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

type PathSeg = {
  dur: number;
  at: (s: number, out: THREE.Vector3) => void;
};

type Contact = { time: number; speed: number };

type BallPath = {
  segs: PathSeg[];
  contacts: Contact[];
  endsOffTable: boolean;
};

function easeIn(t: number): number {
  return t * t;
}

function easeOut(t: number): number {
  return t * (2 - t);
}

function parabolaSeg(p: THREE.Vector3, v: THREE.Vector3, dur: number): PathSeg {
  const p0 = p.clone();
  const v0 = v.clone();
  return {
    dur,
    at: (s, out) =>
      out.set(p0.x + v0.x * s, p0.y + v0.y * s - 0.5 * G * s * s, p0.z + v0.z * s),
  };
}

/** Time for a ballistic y(t) = y0 + vy·t − ½g·t² to reach yTo (positive root). */
function fallTime(y0: number, vy: number, yTo: number): number {
  return (vy + Math.sqrt(vy * vy + 2 * G * Math.max(y0 - yTo, 0))) / G;
}

export function createCupPongScene(host: GameSceneHost): CupPongSceneController {
  const { scene, camera } = host;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), host.celMaterial('#d9b285'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -TABLE_H;
  scene.add(floor);

  const backdrop = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), host.celMaterial('#c09468'));
  wall.position.set(0, 3.2, -2.74);
  const wainscot = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.9), host.celMaterial('#63412a'));
  wainscot.position.set(0, -0.25, -2.72);
  backdrop.add(wall, wainscot);
  scene.add(backdrop);

  const table = new THREE.Group();
  scene.add(table);

  const top = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(TABLE_W, TABLE_LEN, 0.02), {
      depth: 0.05,
      bevelEnabled: false,
    }),
    [host.celMaterial('#2f9e57'), host.celMaterial('#20713d')],
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = -0.05;
  table.add(top);

  const lineMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.016, TABLE_LEN - 0.08), lineMat);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.y = 0.0015;
  table.add(centerLine);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.022, TABLE_LEN - 0.06), lineMat);
    side.rotation.x = -Math.PI / 2;
    side.position.set(sx * (TABLE_W / 2 - 0.04), 0.0015, 0);
    table.add(side);
  }
  for (const sz of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_W - 0.06, 0.022), lineMat);
    end.rotation.x = -Math.PI / 2;
    end.position.set(0, 0.0015, sz * (TABLE_LEN / 2 - 0.04));
    table.add(end);
  }

  const legMat = host.celMaterial('#241f1a');
  const legGeo = new THREE.BoxGeometry(0.05, TABLE_H - 0.05, 0.05);
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(
        sx * (TABLE_W / 2 - 0.16),
        -0.05 - (TABLE_H - 0.05) / 2,
        sz * (TABLE_LEN / 2 - 0.18),
      );
      table.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 0.32, 0.04, 0.04), legMat);
    bar.position.set(0, -0.5, sz * (TABLE_LEN / 2 - 0.18));
    table.add(bar);
  }

  // Red-solo-cup lathe: pedestal foot, tapered body with two thin ridge rings,
  // rolled rim lip. GamePigeon's white lip + pale interior; the flat interior
  // disc doubles as the "liquid" surface a sunk ball visibly dunks below.
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
  // The open mouth: the far inner wall (a back-face frustum) over a sunken
  // dark bottom disc, so cups read as empty — never as capped lids.
  const innerGeo = new THREE.LatheGeometry(
    [new THREE.Vector2(0.0322, CUP_H * 0.42), new THREE.Vector2(0.0432, CUP_H - 0.004)],
    28,
  );
  const innerBottomGeo = new THREE.CircleGeometry(0.0325, 24);
  const rimMat = host.celMaterial('#f2ece1');
  type CupMats = { body: THREE.Material; inner: THREE.Material; bottom: THREE.Material };
  function cupMats(body: string, inner: string, bottom: string): CupMats {
    const innerMat = host.celMaterial(inner);
    innerMat.side = THREE.BackSide;
    return {
      body: host.celMaterial(body),
      inner: innerMat,
      bottom: new THREE.MeshBasicMaterial({ color: bottom }),
    };
  }
  const bodyMats: Record<StageView, CupMats> = {
    throw: cupMats('#3157c8', '#1e3c8e', '#12235a'),
    receive: cupMats('#d83a2e', '#8a2019', '#4d0f09'),
  };
  const cupShadowGeo = new THREE.CircleGeometry(CUP_MOUTH_R * 1.15, 20);
  const cupShadowMat = new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  });

  function makeCup(mats: CupMats): THREE.Group {
    const group = new THREE.Group();
    const cup = new THREE.Mesh(cupGeo, mats.body);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = CUP_H - 0.003;
    const inner = new THREE.Mesh(innerGeo, mats.inner);
    const bottom = new THREE.Mesh(innerBottomGeo, mats.bottom);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = CUP_H * 0.42;
    const shadow = new THREE.Mesh(cupShadowGeo, cupShadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(-0.035, 0.003, 0.028);
    group.add(cup, rim, inner, bottom, shadow);
    return group;
  }

  const rack = new THREE.Group();
  scene.add(rack);
  const rackCups = new Map<number, THREE.Group>();
  let currentView: StageView = 'throw';
  let ballsLeft = 2;

  function buildRack(mask: number): void {
    rack.clear();
    rackCups.clear();
    for (const cup of cupPong.cupPositions(mask)) {
      const mesh = makeCup(bodyMats[currentView]);
      mesh.position.set(cup.x, 0, -cup.y);
      mesh.scale.setScalar(CUP_SCALE);
      rack.add(mesh);
      rackCups.set(cup.slot, mesh);
    }
  }

  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), host.celMaterial('#ffffff'));
  ball.position.copy(BALL_REST);
  scene.add(ball);

  const spare = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), host.celMaterial('#c8c1b4'));
  spare.position.set(-0.17, BALL_R, 0.16);
  const spareShadow = new THREE.Mesh(cupShadowGeo, cupShadowMat);
  spareShadow.rotation.x = -Math.PI / 2;
  spareShadow.scale.setScalar(0.7);
  spareShadow.position.set(-0.01, -BALL_R + 0.004, 0.01);
  spare.add(spareShadow);
  scene.add(spare);

  const ballShadowMat = new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.1, 20), ballShadowMat);
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);

  const ringMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 26), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  let tweens: Tween[] = [];
  let fastForward = false;

  host.onFrame((dt) => {
    const spec = VIEWS[currentView];
    ballShadow.visible =
      ball.visible &&
      ball.position.y > 0 &&
      Math.abs(ball.position.x) < TABLE_W / 2 - 0.02 &&
      ball.position.z > spec.tableFarZ + 0.02 &&
      ball.position.z < spec.tableNearZ - 0.02;
    ballShadow.position.set(ball.position.x, 0.006, ball.position.z);
    const squash = 1 / (1 + ball.position.y * 1.6);
    ballShadow.scale.setScalar(Math.max(squash, 0.35));
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

  function onTable(x: number, z: number): boolean {
    const spec = VIEWS[currentView];
    return (
      Math.abs(x) < TABLE_W / 2 - 0.02 && z > spec.tableFarZ + 0.03 && z < spec.tableNearZ - 0.03
    );
  }

  function cupBlock(p: THREE.Vector3): THREE.Vector3 | null {
    for (const cup of rackCups.values()) {
      if (Math.hypot(p.x - cup.position.x, p.z - cup.position.z) < CUP_BLOCK_R) {
        return cup.position;
      }
    }
    return null;
  }

  /** Play a precomputed piecewise path on one clock, squashing at contacts. */
  function runPath(path: BallPath): Promise<void> {
    const total = path.segs.reduce((sum, seg) => sum + seg.dur, 0);
    const pos = new THREE.Vector3();
    return play(total, (t) => {
      const s = t * total;
      let acc = 0;
      let seg = path.segs[path.segs.length - 1]!;
      let local = seg.dur;
      for (const candidate of path.segs) {
        if (s <= acc + candidate.dur) {
          seg = candidate;
          local = s - acc;
          break;
        }
        acc += candidate.dur;
      }
      seg.at(local, pos);
      ball.position.copy(pos);
      let amt = 0;
      for (const c of path.contacts) {
        const w = 1 - Math.abs(s - c.time) / 0.07;
        if (w > 0) amt = Math.max(amt, w * Math.min(c.speed / 3.2, 1));
      }
      ball.scale.set(1 + 0.3 * amt, 1 - 0.45 * amt, 1 + 0.3 * amt);
    });
  }

  function appendRoll(path: BallPath, from: THREE.Vector3, v: THREE.Vector3): void {
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.06) return;
    const ux = v.x / speed;
    const uz = v.z / speed;
    let dur = Math.min(Math.log(speed / 0.04) / ROLL_K, 0.7);
    const dist = (speed / ROLL_K) * (1 - Math.exp(-ROLL_K * dur));
    let cut = dist;
    let hitsEdge = false;
    const probe = new THREE.Vector3();
    for (let d = 0.01; d < dist; d += 0.01) {
      probe.set(from.x + ux * d, BALL_R, from.z + uz * d);
      if (!onTable(probe.x, probe.z) || cupBlock(probe)) {
        hitsEdge = !onTable(probe.x, probe.z);
        cut = Math.max(d - 0.01, 0.005);
        break;
      }
    }
    if (cut < dist) dur = -Math.log(1 - (ROLL_K * cut) / speed) / ROLL_K;
    const p0 = from.clone();
    path.segs.push({
      dur,
      at: (s, out) => {
        const d = (speed / ROLL_K) * (1 - Math.exp(-ROLL_K * s));
        out.set(p0.x + ux * d, BALL_R, p0.z + uz * d);
      },
    });
    if (hitsEdge) {
      const vCut = speed * Math.exp(-ROLL_K * dur);
      const edgeP = new THREE.Vector3(p0.x + ux * cut, BALL_R, p0.z + uz * cut);
      const fallV = new THREE.Vector3(ux * vCut, 0, uz * vCut);
      path.segs.push(parabolaSeg(edgeP, fallV, fallTime(edgeP.y, 0, -TABLE_H + 0.08)));
      path.endsOffTable = true;
    }
  }

  // Ballistic chain from an airborne (or just-launched) state: parabolas
  // linked by restitution bounces, ending in a friction roll, a dink off a
  // blocking cup, or a fall off the table's edge. Every duration follows from
  // G and the entry velocity — nothing is hand-timed.
  function buildBouncePath(from: THREE.Vector3, vel: THREE.Vector3): BallPath {
    const path: BallPath = { segs: [], contacts: [], endsOffTable: false };
    const p = from.clone();
    const v = vel.clone();
    let time = 0;
    for (let i = 0; i < 5; i++) {
      const dur = fallTime(p.y, v.y, BALL_R);
      const land = new THREE.Vector3(p.x + v.x * dur, BALL_R, p.z + v.z * dur);
      if (!onTable(land.x, land.z)) {
        path.segs.push(parabolaSeg(p, v, fallTime(p.y, v.y, -TABLE_H + 0.08)));
        path.endsOffTable = true;
        return path;
      }
      path.segs.push(parabolaSeg(p, v, dur));
      time += dur;
      const impact = G * dur - v.y;
      path.contacts.push({ time, speed: impact });
      p.copy(land);
      const block = cupBlock(p);
      if (block) {
        const away = new THREE.Vector3(p.x - block.x, 0, p.z - block.z);
        if (away.lengthSq() === 0) away.set(0, 0, 1);
        away.normalize();
        const vy = Math.min(impact * 0.25, 0.45);
        path.segs.push(parabolaSeg(p, new THREE.Vector3(away.x * 0.22, vy, away.z * 0.22), (2 * vy) / G));
        return path;
      }
      v.set(v.x * H_DAMP, impact * TABLE_E, v.z * H_DAMP);
      if ((v.y * v.y) / (2 * G) < 0.01) break;
    }
    appendRoll(path, p, v);
    return path;
  }

  function fadeOut(): Promise<void> {
    return play(0.16, (t) => {
      ball.scale.setScalar(Math.max(1 - easeIn(t), 0.001));
    }).then(() => {
      ball.visible = false;
    });
  }

  async function settleAfter(path: BallPath): Promise<void> {
    await runPath(path);
    if (path.endsOffTable) {
      ball.visible = false;
      return;
    }
    await fadeOut();
  }

  function splash(x: number, z: number): Promise<void> {
    ring.visible = true;
    ring.position.set(x, RIM_Y + 0.012, z);
    return play(0.34, (t) => {
      ring.scale.setScalar(CUP_MOUTH_R * CUP_SCALE * (1 + 1.6 * easeOut(t)));
      ringMat.opacity = 0.85 * (1 - t);
    }).then(() => {
      ring.visible = false;
    });
  }

  async function sinkIntoCup(
    slot: number,
    mouth: THREE.Vector3,
    vyIn: number,
    maskAfter: number,
  ): Promise<void> {
    const cup = rackCups.get(slot);
    const bottomY = CUP_H * 0.42 * CUP_SCALE + BALL_R;
    const dropDur = fallTime(mouth.y, vyIn, bottomY);
    const impact = G * dropDur - vyIn;
    // Rebound stays well below the rim so the plunk reads as swallowed.
    const vy = Math.min(impact * 0.22, Math.sqrt(2 * G * 0.03));
    const rest = new THREE.Vector3(mouth.x, bottomY, mouth.z);
    const plunk = runPath({
      segs: [
        parabolaSeg(mouth, new THREE.Vector3(0, vyIn, 0), dropDur),
        parabolaSeg(rest, new THREE.Vector3(0, vy, 0), (2 * vy) / G),
      ],
      contacts: [{ time: dropDur, speed: impact * 0.7 }],
      endsOffTable: false,
    }).then(() => {
      ball.visible = false;
    });
    const fx = splash(mouth.x, mouth.z);
    const react = cup
      ? play(0.3, (t) => {
          const s = Math.sin(Math.min(t * 1.2, 1) * Math.PI);
          cup.scale.set(
            CUP_SCALE * (1 + 0.1 * s),
            CUP_SCALE * (1 - 0.18 * s),
            CUP_SCALE * (1 + 0.1 * s),
          );
        })
      : Promise.resolve();
    await Promise.all([plunk, fx, react]);
    if (cup) {
      await play(0.16, (t) => {
        cup.scale.setScalar(Math.max(CUP_SCALE * (1 - easeIn(t)), 0.001));
        cup.position.y = -0.04 * easeIn(t);
      });
    }
    buildRack(maskAfter);
  }

  async function rimBounce(
    arc: PathSeg,
    end: THREE.Vector3,
    vEnd: THREE.Vector3,
    landing: { x: number; y: number },
    mask: number,
  ): Promise<void> {
    let nearest: { d: number; slot: number } | null = null;
    for (const cup of cupPong.cupPositions(mask)) {
      const d = Math.hypot(landing.x - cup.x, landing.y - cup.y);
      if (nearest === null || d < nearest.d) nearest = { d, slot: cup.slot };
    }
    const cup = nearest === null ? undefined : rackCups.get(nearest.slot);
    const wobble = cup
      ? play(arc.dur, () => {}).then(() =>
          play(0.5, (t) => {
            cup.rotation.z = 0.2 * Math.sin(t * Math.PI * 4) * (1 - t);
          }),
        )
      : Promise.resolve();
    const out = cup
      ? new THREE.Vector3(end.x - cup.position.x, 0, end.z - cup.position.z)
      : new THREE.Vector3(0, 0, 1);
    if (out.lengthSq() === 0) out.set(0, 0, 1);
    out.normalize();
    // Tangential clip: the rim eats most of the speed, pops the ball up and
    // shunts it radially while a bit of the incoming velocity carries through.
    const hIn = Math.hypot(vEnd.x, vEnd.z);
    const deflect = new THREE.Vector3(
      out.x * hIn * 0.32 + vEnd.x * 0.15,
      Math.abs(vEnd.y) * 0.38,
      out.z * hIn * 0.32 + vEnd.z * 0.15,
    );
    const tail = buildBouncePath(end, deflect);
    const path: BallPath = {
      segs: [arc, ...tail.segs],
      contacts: [
        { time: arc.dur, speed: Math.abs(vEnd.y) },
        ...tail.contacts.map((c) => ({ time: c.time + arc.dur, speed: c.speed })),
      ],
      endsOffTable: tail.endsOffTable,
    };
    await Promise.all([wobble, settleAfter(path)]);
  }

  function stage(view: StageView, targetMask: number): void {
    currentView = view;
    const spec = VIEWS[view];
    camera.position.fromArray(spec.framing.pos);
    camera.fov = spec.framing.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(new THREE.Vector3().fromArray(spec.framing.target));
    table.position.z = (spec.tableFarZ + spec.tableNearZ) / 2;
    backdrop.visible = view === 'throw';
    buildRack(targetMask);
    ring.visible = false;
    ball.visible = true;
    ball.scale.setScalar(1);
    ball.position.copy(BALL_REST);
    spare.visible = view === 'throw' && ballsLeft >= 2;
  }

  return {
    stage,

    setBallsLeft: (n) => {
      ballsLeft = n;
      spare.visible = currentView === 'throw' && n >= 2;
    },

    setAimCue: (x) => {
      ball.position.x = x === null ? 0 : x * AIM_NUDGE;
    },

    animateThrow: async (flick, visual) => {
      const flight = cupPong.throwFlight(flick);
      const start = new THREE.Vector3(ball.position.x, BALL_R, 0);
      const end = new THREE.Vector3(flight.landing.x, BALL_R, -flight.landing.y);
      if (visual.cupSlot !== null || visual.rimNearMiss) end.y = RIM_Y + BALL_R;
      // Launch velocity solved from G, the flight time and the endpoints, so
      // the arc is a genuine parabola into core's authoritative landing point.
      const T = flight.duration * FLIGHT_SCALE;
      const v0 = new THREE.Vector3(
        (end.x - start.x) / T,
        (end.y - start.y) / T + (G * T) / 2,
        (end.z - start.z) / T,
      );
      const vEnd = new THREE.Vector3(v0.x, v0.y - G * T, v0.z);
      ball.visible = true;
      ball.scale.setScalar(1);
      ball.position.copy(start);
      if (visual.cupSlot !== null) {
        await runPath({
          segs: [parabolaSeg(start, v0, T)],
          contacts: [],
          endsOffTable: false,
        });
        await sinkIntoCup(visual.cupSlot, end, vEnd.y, visual.targetMaskAfter);
      } else if (visual.rimNearMiss) {
        await rimBounce(parabolaSeg(start, v0, T), end, vEnd, flight.landing, visual.targetMaskAfter);
      } else {
        await settleAfter(buildBouncePath(start, v0));
      }
      ball.scale.setScalar(1);
      ball.position.copy(BALL_REST);
      ball.visible = true;
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
