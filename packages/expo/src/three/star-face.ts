import * as THREE from 'three';

import STAR_FACE from './star-face.json';

// The constellation of the sidekick that hangs in the guided-session night sky.
//
// Same shape as this directory's other scene features (makeGrassEnvironment,
// createFaceController, createInteraction): a factory returning a group plus a
// per-frame update, so renderer.ts composes this rather than containing it.
//
// The geometry is PRECOMPUTED — `pnpm build-star-face` (scripts/build-star-face.mjs)
// carves the head off the body, contour-traces its silhouette, wraps the face
// sheet's eyes and mouth onto the dome, and scatters volume dust over the
// surface. Re-run it if the model or face sheet changes; nothing here derives
// shape at runtime (expo-gl can't read pixels back, so it couldn't anyway).
//
// star-face.json is in constellation space: centred on the head, 1 unit across,
// +z toward the viewer.

// star face — tuned values 2026-07-22 (scripts/build-star-face.mjs owns star COUNTS)
const STAR_HEAD_AT = new THREE.Vector3(0, 28.93, -29);
const STAR_HEAD_SIZE = 15.01; // world units across
// pan-up view axis is ~26° above horizontal, so pitch the head by the same to
// face back down it (atan2 of COSMOS_FRAMING's target-minus-pos)
const STAR_HEAD_PITCH = Math.atan2(7.4, 15);
// The cloud doesn't move — a travelling shine does the work instead, brightening
// it in slow bands so it feels alive without spinning. SPEED is radians/sec of
// the sweep; DEPTH is how much of a star's brightness it swings (0 = steady).
const STAR_SHINE_SPEED = 1.634;
const STAR_SHINE_DEPTH = 0.544;
// how loud the joins are. Low: they hint at the contour, the stars carry it.
const STAR_LINE_ALPHA = 0.276;
// A very slow breath — it rocks a couple of degrees on pitch and drifts in and
// out a little. Not the yaw drift this used to have (that read as a turning
// head); this is small enough to feel like the sky itself moving.
const STAR_PULSE_AMT = 0.042; // radians of pitch
const STAR_PULSE_DEPTH = 1.906; // world units in/out
const STAR_PULSE_HZ = 0.087; // ~11s a breath
// dust brightness relative to a contour star — atmosphere, not structure
const STAR_DUST_WEIGHT = 0.33;
// point-size multiplier for every star in the cloud
const STAR_SIZE = 1.106;

function toStarPositions(list: number[][]): Float32Array {
  const out = new Float32Array(list.length * 3);
  list.forEach((p, i) => {
    out[i * 3] = p[0] * STAR_HEAD_SIZE;
    out[i * 3 + 1] = p[1] * STAR_HEAD_SIZE;
    out[i * 3 + 2] = p[2] * STAR_HEAD_SIZE;
  });
  return out;
}

// TEMPORARY: the shape the look-dev sliders push in (store/starFaceConfig.ts).
export type StarFaceConfig = {
  lineAlpha: number;
  dustWeight: number;
  starSize: number;
  shineSpeed: number;
  shineDepth: number;
  size: number;
  height: number;
  depth: number;
  pitch: number;
  pulseAmt: number;
  pulseDepth: number;
  pulseHz: number;
};

export type StarFace = {
  group: THREE.Group;
  // call per frame: `now` in seconds, `cosmosT` the meadow→night-sky blend
  update: (now: number, cosmosT: number) => void;
  // TEMPORARY: live look-dev (see store/starFaceConfig.ts)
  setConfig: (c: StarFaceConfig) => void;
};

export function makeStarFace(): StarFace {
  // star head — the sidekick, drawn in stars, hanging in the night sky. The
  // silhouette and the eyes/mouth are traced contours joined by faint lines,
  // sitting inside a cloud of volume dust (stars in front AND behind) so it
  // never reads as a flat decal. It's simply THERE: no beat-driven assembly, it
  // just fades up with the pan into the sky.
  // Geometry is precomputed; see scripts/build-star-face.mjs.
  // uShine*/uStarSize/uLineAlpha are uniforms (not baked constants) so the
  // temporary tuning sliders can drive them without a shader rebuild
  const headUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uShineSpeed: { value: STAR_SHINE_SPEED },
    uShineDepth: { value: STAR_SHINE_DEPTH },
    uStarSize: { value: STAR_SIZE },
    uLineAlpha: { value: STAR_LINE_ALPHA },
    // half-depth of the cloud in world units — drives the near/far fade. Passed
    // in rather than read off modelMatrix, whose diagonal isn't the scale once
    // the group is pitched.
    uHalfSpan: { value: STAR_HEAD_SIZE * 0.35 },
    uDustW: { value: STAR_DUST_WEIGHT },
  };
  const starHeadGroup = new THREE.Group();
  starHeadGroup.position.copy(STAR_HEAD_AT);
  // pitch it down the camera's pan-up axis so it faces the user
  starHeadGroup.rotation.x = STAR_HEAD_PITCH;
  // (renderer.ts adds `group` to cosmosGroup)
  // the pose the slow breath oscillates around (setStarFace moves the rest pose;
  // the animate loop adds the breath, so the two never fight over the transform)
  const starRest = {
    height: STAR_HEAD_AT.y,
    depth: STAR_HEAD_AT.z,
    pitch: STAR_HEAD_PITCH,
    pulseAmt: STAR_PULSE_AMT,
    pulseDepth: STAR_PULSE_DEPTH,
    pulseHz: STAR_PULSE_HZ,
  };

  const headMat = new THREE.ShaderMaterial({
    uniforms: headUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'attribute float aPhase; attribute float aW;\n' +
      'uniform float uTime; uniform float uShineSpeed; uniform float uShineDepth;\n' +
      'uniform float uStarSize; uniform float uHalfSpan; uniform float uDustW;\n' +
      'varying float vB;\n' +
      'void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);\n' +
      '  vec4 c = modelViewMatrix * vec4(0.0,0.0,0.0,1.0);\n' +
      // +z is toward the camera in view space, so a bigger mv.z is nearer. Depth
      // is measured against the cloud's OWN centre (and scaled by its own size)
      // so it holds under any framing or scale.
      '  float near = clamp((mv.z - c.z) / max(0.001, uHalfSpan) + 0.5, 0.0, 1.0);\n' +
      '  float w = mix(uDustW, 1.0, aW);\n' +
      '  float tw = 0.74 + 0.26*sin(uTime*1.6 + aPhase);\n' +
      // a slow shine drifting across the cloud, so the head brightens in bands
      // instead of pulsing as one lump — this is what replaces rotating it
      '  float sweep = 0.5 + 0.5*sin(uTime*uShineSpeed - (position.x*0.3 + position.y*0.17));\n' +
      '  vB = w * tw * ((1.0 - uShineDepth) + uShineDepth*sweep) * (0.25 + 0.75*near);\n' +
      '  gl_PointSize = uStarSize * (0.7 + 1.5*near) * (0.55 + 0.45*w) * tw * (200.0 / -mv.z);\n' +
      '  gl_Position = projectionMatrix * mv; }',
    fragmentShader:
      'uniform float uOpacity; varying float vB;\n' +
      'void main(){ float r = length(gl_PointCoord - 0.5);\n' +
      '  float core = smoothstep(0.2, 0.0, r); float glow = smoothstep(0.5, 0.1, r) * 0.45;\n' +
      '  float a = min(1.0, core + glow);\n' +
      '  gl_FragColor = vec4(0.92, 0.9, 1.0, a * vB * uOpacity); }',
  });
  const starHead = new THREE.Points(new THREE.BufferGeometry(), headMat);
  // culling against a swapped-in geometry's bounds drops the object outright on
  // expo-gl — same reason every character mesh here does it
  starHead.frustumCulled = false;
  starHead.renderOrder = -1;
  starHeadGroup.add(starHead);

  // the joins. Faint on purpose — they should suggest the contour, not draw the
  // character; the stars are the thing you look at. One LineSegments for all
  // four loops: a LineLoop can only close a single ring.
  const headLineMat = new THREE.ShaderMaterial({
    uniforms: headUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform float uOpacity; uniform float uLineAlpha;\n' +
      'void main(){ gl_FragColor = vec4(0.62, 0.58, 0.95, uOpacity * uLineAlpha); }',
  });
  const starHeadLines = new THREE.LineSegments(new THREE.BufferGeometry(), headLineMat);
  starHeadLines.frustumCulled = false;
  starHeadLines.renderOrder = -2;
  starHeadGroup.add(starHeadLines);

  {
    // one cloud: contour stars at full weight, dust at a fraction, so the drawn
    // shape stays the thing your eye lands on
    const loopPts: number[][] = STAR_FACE.loops.flatMap((l) => l.points);
    const all = [...loopPts, ...STAR_FACE.dust.positions];
    const phase = new Float32Array(all.length);
    const weight = new Float32Array(all.length);
    for (let i = 0; i < all.length; i++) {
      phase[i] = (i * 2.399) % (Math.PI * 2); // deterministic twinkle spread
      weight[i] = i < loopPts.length ? 1 : 0; // 1 = contour, 0 = dust; uDustW mixes
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(toStarPositions(all), 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aW', new THREE.BufferAttribute(weight, 1));
    starHead.geometry = g;

    // close each loop on itself
    const segs: number[] = [];
    for (const loop of STAR_FACE.loops) {
      const pts = loop.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        segs.push(a[0] * STAR_HEAD_SIZE, a[1] * STAR_HEAD_SIZE, a[2] * STAR_HEAD_SIZE);
        segs.push(b[0] * STAR_HEAD_SIZE, b[1] * STAR_HEAD_SIZE, b[2] * STAR_HEAD_SIZE);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    starHeadLines.geometry = lg;
  }
  return {
    group: starHeadGroup,
    update: (now, cosmosT) => {
      // the star head rides the sky's crossfade — it's simply there, assembling
      // nothing; it just resolves out of the dark as the camera reaches the sky.
      // Lag it slightly behind cosmosT so the sky arrives first and the head
      // settles into it rather than flying up with the camera.
      headUniforms.uOpacity.value = Math.max(0, cosmosT * 1.35 - 0.35);
      headUniforms.uTime.value = now;
      // the slow breath: a couple of degrees of pitch and a small drift in/out,
      // offset a quarter-cycle so the rock and the drift don't peak together
      // (that reads as one lump moving; out of phase it reads as something alive)
      const breathT = now * Math.PI * 2 * starRest.pulseHz;
      starHeadGroup.rotation.x = starRest.pitch + Math.sin(breathT) * starRest.pulseAmt;
      starHeadGroup.position.y = starRest.height;
      starHeadGroup.position.z = starRest.depth + Math.sin(breathT + Math.PI / 2) * starRest.pulseDepth;
    },
    setConfig: (c) => {
      headUniforms.uLineAlpha.value = c.lineAlpha;
      headUniforms.uDustW.value = c.dustWeight;
      headUniforms.uStarSize.value = c.starSize;
      headUniforms.uShineSpeed.value = c.shineSpeed;
      headUniforms.uShineDepth.value = c.shineDepth;
      headUniforms.uHalfSpan.value = c.size * 0.35;
      // the JSON is 1 unit across, so scale IS the size in world units
      starHeadGroup.scale.setScalar(c.size / STAR_HEAD_SIZE);
      // update() adds the breath on top of this rest pose, so the two never
      // fight over rotation.x / position.z
      starRest.height = c.height;
      starRest.depth = c.depth;
      starRest.pitch = c.pitch;
      starRest.pulseAmt = c.pulseAmt;
      starRest.pulseDepth = c.pulseDepth;
      starRest.pulseHz = c.pulseHz;
    },
  };
}
