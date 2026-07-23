import * as THREE from 'three';

// Ported from sidekick/src/components/sidekick-interact.ts. The spring model
// and per-frame outputs are verbatim; only the input plumbing changed —
// instead of owning DOM pointer events, the module exposes down/move/up taking
// NDC coordinates, fed by the canvas component.
//
// Touch deltas from web:
//  - no hover: his gaze tracks the finger only while it's on the glass, and
//    eases back to camera after release (the web left him staring at the last
//    mouse position, which reads wrong without a visible cursor).
//  - classification does NOT raycast the skinned meshes. three's skinned
//    raycast applies bone transforms to EVERY vertex in JS — on Hermes (no
//    JIT) that blocks for seconds per tap (a hard freeze), and this GLB's
//    out-of-range skinIndices can throw besides. Instead the touch is
//    projected onto the camera-facing plane through the character (the same
//    pointerPoint used for gaze) and classified by world distance to the
//    hand/head bones and the body's bounds — same semantics, O(1) work.

export type PokePart = 'head' | 'handL' | 'handR' | 'body' | 'ground';

export type ArmPull = { swing: number; fwd: number; stretch: number };
export type LegPull = { lift: number; curl: number };

// everything the renderer needs to apply per frame (object reused — don't retain)
export type InteractionFrame = {
  headPitch: number;
  headYaw: number;
  armL: ArmPull;
  armR: ArmPull;
  legL: LegPull;
  legR: LegPull;
  // spine-chain bend (world X/Z) — split across Waist + Spine01 so the body
  // ARCS toward the grab point instead of tilting as one plank
  bendX: number;
  bendZ: number;
  bodyX: number;
  bodyZ: number;
  tiltX: number;
  tiltZ: number;
  squash: number; // vertical scale multiplier, ~1
  camYaw: number;
  camPitch: number;
  dragging: PokePart | null;
};

// damped spring toward `target`; under-damped on purpose so releases overshoot
class Spring {
  x = 0;
  v = 0;
  target = 0;
  constructor(
    private k: number,
    private c: number,
  ) {}
  update(dt: number): number {
    this.v += (-this.k * (this.x - this.target) - this.c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(v: number): void {
    this.v += v;
  }
}

// A short, decaying oscillation overlaid on a channel — a head-shake ("no-no-no")
// or a ticklish body-wiggle. Triggered on poke, sampled per frame, self-clears.
class Wiggle {
  private amp = 0;
  private freq = 0;
  private start = -1;
  trigger(amp: number, freq: number, t: number): void {
    this.amp = amp;
    this.freq = freq;
    this.start = t;
  }
  sample(t: number): number {
    if (this.start < 0) return 0;
    const e = t - this.start;
    const decay = Math.exp(-e * 5.5); // ~0.5s tail
    if (decay < 0.02) {
      this.start = -1;
      return 0;
    }
    return this.amp * decay * Math.sin(e * this.freq * Math.PI * 2);
  }
}

const TAP_MAX_NDC = 0.02; // pointer travel below this counts as a tap
const TAP_MAX_MS = 350;
const HAND_RADIUS = 0.14; // character is normalized to 1 unit tall

export type Interaction = {
  // touch input in NDC (-1..1, +y up). down/up return nothing; the component
  // converts view px → NDC before calling.
  down: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  up: (x: number, y: number) => void;
  update: (t: number) => InteractionFrame;
};

export function createInteraction(opts: {
  camera: THREE.Camera;
  bone: (n: 'head' | 'handL' | 'handR') => THREE.Object3D | undefined;
  cameraDrag?: boolean;
  // `big` = the boiling-over reaction (kept-at-it pokes): the renderer plays a
  // jump with hands thrown up; the host layer adds haptics + a "Hey!" bubble
  onPoke?: (part: PokePart, point: THREE.Vector3, expr: string | null, big?: boolean) => void;
}): Interaction {
  const { camera } = opts;

  const headPitch = new Spring(90, 12);
  const headYaw = new Spring(90, 12);
  const arm = {
    L: { swing: new Spring(140, 9), fwd: new Spring(140, 10), stretch: new Spring(160, 10) },
    R: { swing: new Spring(140, 9), fwd: new Spring(140, 10), stretch: new Spring(160, 10) },
  };
  const bodyX = new Spring(130, 9);
  const bodyZ = new Spring(130, 9);
  const tiltX = new Spring(130, 8);
  const tiltZ = new Spring(130, 8);
  const bendX = new Spring(120, 9);
  const bendZ = new Spring(120, 9);
  const legL = new Spring(110, 7);
  const legR = new Spring(110, 7);
  const squash = new Spring(110, 6);
  const camYaw = new Spring(70, 7);
  const camPitch = new Spring(70, 7);

  // emotive poke overlays + escalation. Rapid repeated pokes within POKE_WINDOW
  // stack pokeCount toward annoyance (3+) then the big boil-over (5+ — jump,
  // hands up, "Hey!"); an isolated poke resets it.
  const headShake = new Wiggle();
  const bodyWiggle = new Wiggle();
  let pokeCount = 0;
  let lastPokeAt = -10;
  const POKE_WINDOW = 1.3; // seconds

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hover = new THREE.Vector2(); // last touch pos while the finger is down
  let touching = false;
  const lookPoint = new THREE.Vector3();
  const LOOK_HOLD = 0.8; // seconds a tap holds his gaze before it eases back
  let lookHoldUntil = -1; // taps hold his gaze on the point briefly (LOOK_HOLD)
  const plane = new THREE.Plane();
  const camDir = new THREE.Vector3();
  const boneWorld = new THREE.Vector3();
  const headWorld = new THREE.Vector3();
  const lookDir = new THREE.Vector3();

  let drag: { part: PokePart; x0: number; y0: number; t0: number; moved: boolean; grabH: number } | null = null;
  let now = 0;
  let last = -1;

  // world point under the touch, on the camera-facing plane through him
  const pointerPoint = (out: THREE.Vector3): THREE.Vector3 => {
    raycaster.setFromCamera(ndc, camera);
    camera.getWorldDirection(camDir);
    plane.setFromNormalAndCoplanarPoint(camDir, out.set(0, 0.6, 0));
    return raycaster.ray.intersectPlane(plane, out) ?? out.copy(raycaster.ray.at(3, out));
  };

  // character is normalized to 1 unit tall, centered on x/z at the origin
  const BODY_HALF_W = 0.42;
  const BODY_TOP = 1.08; // a little over 1 so the ear/crown region still grabs
  const touchPoint = new THREE.Vector3();
  const classify = (): { part: PokePart; grabH: number } => {
    // world point under the touch, on the camera-facing plane through him —
    // stands in for the web's mesh raycast hit (see header note)
    const p = pointerPoint(touchPoint);
    // grab height as a fraction of him (feet 0 → crown 1) — a pull anchors
    // where you're actually holding: high grabs bend him, low grabs slide him
    const grabH = THREE.MathUtils.clamp(p.y, 0, 1);
    for (const side of ['handL', 'handR'] as const) {
      const b = opts.bone(side);
      if (b && p.distanceTo(b.getWorldPosition(boneWorld)) < HAND_RADIUS) return { part: side, grabH };
    }
    const horiz = Math.hypot(p.x, p.z);
    if (horiz > BODY_HALF_W || p.y < 0.02 || p.y > BODY_TOP) return { part: 'ground', grabH };
    const head = opts.bone('head');
    if (head && p.y > head.getWorldPosition(boneWorld).y - 0.05) return { part: 'head', grabH };
    return { part: 'body', grabH };
  };

  const down = (x: number, y: number) => {
    if (drag) return;
    ndc.set(x, y);
    hover.copy(ndc);
    touching = true;
    const { part, grabH } = classify();
    drag = { part, x0: x, y0: y, t0: performance.now(), moved: false, grabH };
  };

  const move = (x: number, y: number) => {
    if (!drag) return;
    ndc.set(x, y);
    hover.copy(ndc);
    const dx = ndc.x - drag.x0;
    const dy = ndc.y - drag.y0;
    const dist = Math.hypot(dx, dy);
    if (dist > TAP_MAX_NDC) drag.moved = true;
    const clamp = THREE.MathUtils.clamp;
    if (drag.part === 'handL' || drag.part === 'handR') {
      // vertical pull raises/lowers the arm (mirrored per side), horizontal
      // pull swings it outward/inward; distance stretches the whole limb
      const side = drag.part === 'handL' ? 1 : -1;
      const a = arm[drag.part === 'handL' ? 'L' : 'R'];
      a.swing.target = clamp(1.7 * dy * side + 1.3 * dx, -1.5, 1.5);
      a.fwd.target = -0.45 * Math.min(0.6, dist); // eases toward the camera
      a.stretch.target = clamp(0.55 * dist, 0, 0.38);
    } else if (drag.part === 'body' || drag.part === 'head') {
      // the pull anchors at the grab point: grabbing high mostly BENDS the
      // spine chain toward the pointer, grabbing low mostly slides him
      const gh = drag.grabH;
      const wBend = 0.3 + 1.1 * gh;
      const wSlide = 1.15 - 0.8 * gh;
      bendZ.target = clamp(-1.05 * dx * wBend, -0.55, 0.55);
      bendX.target = clamp(-0.85 * dy * wBend, -0.42, 0.42);
      tiltZ.target = clamp(-0.22 * dx, -0.14, 0.14);
      tiltX.target = clamp(-0.18 * dy, -0.1, 0.1);
      bodyX.target = clamp(0.32 * dx * wSlide, -0.22, 0.22);
      // pulling up stretches him taller, pushing down squashes
      squash.target = clamp(0.3 * dy * gh, -0.12, 0.22);
      // secondary motion: arms swing after the yank, like being tugged
      arm.L.swing.target = clamp(0.85 * dy + 0.7 * dx, -1.1, 1.1);
      arm.R.swing.target = clamp(-0.85 * dy + 0.7 * dx, -1.1, 1.1);
      // off balance: past a small lean the trailing leg lifts off the ground
      const lift = Math.min(0.55, Math.max(0, Math.abs(dx) - 0.04) * 2.4);
      legL.target = dx < 0 ? lift : 0; // his left leg = screen right
      legR.target = dx > 0 ? -lift : 0;
    } else if (opts.cameraDrag) {
      camYaw.target = clamp(-1.3 * dx, -0.5, 0.5);
      camPitch.target = clamp(dy, -0.28, 0.28);
    }
  };

  const up = (x: number, y: number) => {
    touching = false;
    if (!drag) return;
    const wasTap = !drag.moved && performance.now() - drag.t0 < TAP_MAX_MS;
    const part = drag.part;
    drag = null;
    // all drag targets home to zero — the springs do the bounce-back
    for (const a of [arm.L, arm.R]) {
      a.swing.target = 0;
      a.fwd.target = 0;
      a.stretch.target = 0;
    }
    tiltX.target = tiltZ.target = bodyX.target = bodyZ.target = squash.target = 0;
    bendX.target = bendZ.target = legL.target = legR.target = 0;
    camYaw.target = camPitch.target = 0;
    if (!wasTap) return;
    // tap: look at the point, then react — physically (spring kicks + wiggles)
    // and emotionally (a face expression). Rapid repeated pokes escalate his
    // mood from playful → annoyed → the boil-over jump; a pause resets it.
    ndc.set(x, y);
    pointerPoint(lookPoint);
    lookHoldUntil = now + LOOK_HOLD;

    // ground taps aren't pokes AT him — they don't react and don't escalate
    if (part === 'ground') {
      opts.onPoke?.(part, lookPoint, null, false);
      return;
    }
    const gap = now - lastPokeAt;
    pokeCount = gap < POKE_WINDOW ? pokeCount + 1 : 1;
    lastPokeAt = now;
    const annoyed = pokeCount >= 3;
    const big = pokeCount >= 5;

    let expr: string | null;
    if (big) {
      // boiling over: the renderer plays the jump (hands thrown up) off the
      // `big` flag; here just the sharp head-shake — arm kicks would fight the
      // jump's own arms-overhead envelope. Counter resets so the escalation
      // starts from playful again.
      headShake.trigger(0.5, 5.5, now);
      expr = 'annoyed';
      pokeCount = 0;
    } else if (annoyed) {
      // irritated recoil wherever he's poked: a sharp head-shake, a lean back,
      // arms flicking in, a stomp-y squash
      headShake.trigger(0.42, 5.5, now);
      tiltX.kick(0.7);
      squash.kick(0.7);
      arm.L.swing.kick(-3);
      arm.R.swing.kick(3);
      expr = 'annoyed';
    } else if (part === 'body') {
      // ticklish: a squish plus a quick squirming twist
      squash.kick(1.1);
      bodyWiggle.trigger(0.16, 3.5, now);
      expr = 'excited';
    } else if (part === 'head') {
      headPitch.kick(-2.2); // startled head-bob…
      tiltX.kick(0.18); // …plus a tiny recoil back
      squash.kick(0.5);
      expr = 'excited';
    } else if (part === 'handL') {
      arm.L.swing.kick(5);
      squash.kick(0.4); // little hop
      expr = 'excited';
    } else {
      arm.R.swing.kick(-5);
      squash.kick(0.4);
      expr = 'excited';
    }
    opts.onPoke?.(part, lookPoint, expr, big);
  };

  const frame: InteractionFrame = {
    headPitch: 0,
    headYaw: 0,
    armL: { swing: 0, fwd: 0, stretch: 0 },
    armR: { swing: 0, fwd: 0, stretch: 0 },
    legL: { lift: 0, curl: 0 },
    legR: { lift: 0, curl: 0 },
    bendX: 0,
    bendZ: 0,
    bodyX: 0,
    bodyZ: 0,
    tiltX: 0,
    tiltZ: 0,
    squash: 1,
    camYaw: 0,
    camPitch: 0,
    dragging: null,
  };

  return {
    down,
    move,
    up,
    update(t: number): InteractionFrame {
      now = t;
      const dt = last < 0 ? 0.016 : Math.min(t - last, 0.05);
      last = t;

      // gaze: a tapped point holds his eyes for a beat; while touching he
      // tracks the finger; otherwise he settles back to camera
      const head = opts.bone('head');
      if (t < lookHoldUntil && head) {
        head.getWorldPosition(headWorld);
        lookDir.copy(lookPoint).sub(headWorld);
        const horiz = Math.hypot(lookDir.x, lookDir.z);
        headYaw.target = THREE.MathUtils.clamp(Math.atan2(lookDir.x, lookDir.z), -0.7, 0.7);
        headPitch.target = THREE.MathUtils.clamp(-Math.atan2(lookDir.y, horiz), -0.45, 0.45);
      } else if (touching) {
        headYaw.target = hover.x * 0.45;
        headPitch.target = -hover.y * 0.22;
      } else {
        headYaw.target = 0;
        headPitch.target = 0;
      }

      frame.headPitch = headPitch.update(dt);
      // + the emotive head-shake overlay ("no-no-no" when annoyed)
      frame.headYaw = headYaw.update(dt) + headShake.sample(now);
      for (const [key, sp] of [
        [frame.armL, arm.L],
        [frame.armR, arm.R],
      ] as const) {
        key.swing = sp.swing.update(dt);
        key.fwd = sp.fwd.update(dt);
        key.stretch = Math.max(-0.2, sp.stretch.update(dt));
      }
      frame.bodyX = bodyX.update(dt);
      frame.bodyZ = bodyZ.update(dt);
      frame.tiltX = tiltX.update(dt);
      frame.tiltZ = tiltZ.update(dt);
      frame.bendX = bendX.update(dt);
      // + the ticklish body-wiggle overlay (a quick squirming twist)
      frame.bendZ = bendZ.update(dt) + bodyWiggle.sample(now);
      frame.legL.lift = legL.update(dt);
      frame.legR.lift = legR.update(dt);
      // a lifted leg dangles: the knee curls back with the lift
      frame.legL.curl = -0.75 * Math.abs(frame.legL.lift);
      frame.legR.curl = -0.75 * Math.abs(frame.legR.lift);
      frame.squash = Math.max(0.6, 1 + squash.update(dt));
      frame.camYaw = camYaw.update(dt);
      frame.camPitch = camPitch.update(dt);
      frame.dragging = drag && drag.part !== 'ground' ? drag.part : null;
      return frame;
    },
  };
}

