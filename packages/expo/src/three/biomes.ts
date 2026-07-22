import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { TimeOfDay } from './settings';

// Ported near-verbatim from web's src/components/sidekick-biomes.ts (+ the
// AREA_BIOME island→biome map, which lived in web's world-map.tsx).
//
// Procedural low-poly biomes the character can travel to from the world map.
// Each biome is a self-contained look: a ground the character stands on,
// scattered props, distant silhouettes, plus a light/sky/fog preset so the
// whole scene reads as that place. Deterministic (no Math.random) so renders
// are stable, and everything is flat-shaded chunky geo.
//
// DOM-free by construction: the web original never touched document/window/
// canvas (all geometry is generated math; the only "texture" work happens in
// the renderer's sky gradient, not here), so nothing needed a DataTexture
// swap. Presets are plain color strings the renderer turns into sky/fog/lights.
//
// expo-gl caveats (flagged, NOT fixed here — integration in renderer.ts owns
// these):
//  - tropical's ocean is a MeshStandardMaterial (roughness/metalness). On
//    expo-gl it will sample the scene's PMREM environment map; if the renderer
//    sets scene.environment for the meadow's PBR look, that env reflection
//    carries into the water. Expect the water tone to shift with whatever env
//    is active — verify the swap clears/sets env appropriately per biome.
//  - volcano + tropical use emissive/basic materials with `fog: false`
//    (lava pools, ember veins, crater glow, distant water). The renderer's
//    patchWorldFog() world-fog patch must leave these untouched or the glow
//    hazes out. `fog: false` is the intended opt-out; make sure the patch
//    respects the material.fog flag rather than force-fogging everything.

export type BiomeId = 'snow' | 'desert' | 'forest' | 'blossom' | 'tropical' | 'volcano';
// the home meadow plus every travel biome — what the canvas's `environment` accepts
export type EnvironmentId = 'meadow' | BiomeId;

// the environment look the canvas applies when you enter a biome (sky gradient,
// fog, light rig, exposure) — a lean cousin of ScenePreset
export type BiomePreset = {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  fog: string;
  fogNear: number;
  fogFar: number;
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
  // cinematic direction of the raking key light and the backlight rim (world
  // vectors), plus cast-shadow strength
  keyDir: [number, number, number];
  rimDir: [number, number, number];
  shadow: number;
};

export type Biome = {
  preset: BiomePreset;
  build: () => THREE.Group; // ground + props + distant ring; feet stand at y=0
};

// ---- deterministic helpers -------------------------------------------------

function rand(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// smooth-ish value noise in ~[-1,1] for gentle ground undulation
function noise2(x: number, z: number): number {
  return (Math.sin(x * 1.7 + z * 0.9) + Math.sin(x * 0.5 - z * 1.3) + Math.sin(x * 2.3 + z * 1.9)) / 3;
}

// a big chunky ground, flat near the character (so he stands level) and gently
// bumpy toward the horizon; fog fades the far edge
function makeGround(color: string, bump: number, seed: number): THREE.Mesh {
  const size = 220;
  const seg = 56; // low-ish for faceted low-poly reads
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = Math.hypot(v.x, v.z);
    const fall = THREE.MathUtils.smoothstep(d, 3.5, 20); // flat disc under the character
    v.y = noise2(v.x * 0.06 + seed, v.z * 0.06) * bump * fall;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// a faceted rock: a subdivided box nudged around by hash noise
function makeRock(w: number, h: number, d: number, color: string, seed: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.x += (rand(seed + i * 1.7) - 0.5) * w * 0.3;
    v.y += (rand(seed + i * 2.3) - 0.5) * h * 0.26;
    v.z += (rand(seed + i * 3.1) - 0.5) * d * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
}

// a rounded, chunky boulder: an icosahedron with each vertex jittered outward,
// flat-shaded — reads as a rock rather than a box (which makeRock is better for
// flat-topped mesas)
function makeBoulder(radius: number, color: string, seed: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(0.78 + rand(seed + i * 1.9) * 0.5);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  mesh.scale.y = 0.62 + rand(seed) * 0.3; // squash so it sits like a rock
  mesh.castShadow = true;
  return mesh;
}

// scatter `n` items on a ring band (avoids the flat centre where the character is)
function scatter(
  group: THREE.Group,
  n: number,
  minR: number,
  maxR: number,
  seed: number,
  make: (i: number) => THREE.Object3D,
): void {
  for (let i = 0; i < n; i++) {
    const a = rand(seed + i * 1.13) * Math.PI * 2;
    const r = minR + rand(seed + i * 2.37) * (maxR - minR);
    const o = make(i);
    o.position.set(Math.cos(a) * r, o.position.y, Math.sin(a) * r);
    o.rotation.y = rand(seed + i * 3.7) * Math.PI * 2;
    group.add(o);
  }
}

// ---- snow ------------------------------------------------------------------

// a pine: stacked green cones on a short trunk, optionally snow-dusted
function pineTree(scale: number, snowy = false, green = '#2f6b46'): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.6, 6),
    new THREE.MeshLambertMaterial({ color: '#6b4a2f', flatShading: true }),
  );
  trunk.position.y = 0.28;
  g.add(trunk);
  const greenMat = new THREE.MeshLambertMaterial({ color: green, flatShading: true });
  const snow = new THREE.MeshLambertMaterial({ color: '#eef4fb', flatShading: true });
  let y = 0.5;
  for (let i = 0; i < 3; i++) {
    const r = 0.72 - i * 0.16;
    const h = 0.72;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), greenMat);
    cone.position.y = y + h / 2;
    cone.castShadow = true;
    g.add(cone);
    if (snowy) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, h * 0.42, 7), snow);
      cap.position.y = y + h * 0.82;
      g.add(cap);
    }
    y += h * 0.56;
  }
  g.scale.setScalar(scale);
  return g;
}

// a round leafy tree: a trunk crowned with a few faceted foliage blobs
function leafyTree(scale: number, seed: number, leaf: string): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.19, 1.0, 6),
    new THREE.MeshLambertMaterial({ color: '#6b4a2f', flatShading: true }),
  );
  trunk.position.y = 0.5;
  g.add(trunk);
  const mat = new THREE.MeshLambertMaterial({ color: leaf, flatShading: true });
  const blobs = 3 + Math.floor(rand(seed) * 2);
  for (let i = 0; i < blobs; i++) {
    const r = 0.5 + rand(seed + i) * 0.35;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    blob.position.set(
      (rand(seed + i * 2) - 0.5) * 0.7,
      1.1 + i * 0.42 + rand(seed + i * 3) * 0.2,
      (rand(seed + i * 4) - 0.5) * 0.7,
    );
    blob.scale.y = 0.92;
    blob.castShadow = true;
    g.add(blob);
  }
  g.scale.setScalar(scale);
  return g;
}

// a palm: a segmented curved trunk with drooping fronds at the top
function palmTree(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const barkMat = new THREE.MeshLambertMaterial({ color: '#7a5a34', flatShading: true });
  const lean = (rand(seed) - 0.5) * 0.5;
  let y = 0;
  let x = 0;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.45, 6), barkMat);
    seg.position.set(x, y + 0.22, 0);
    seg.rotation.z = -lean * (i / segs);
    g.add(seg);
    y += 0.42;
    x += lean * 0.14 * (i / segs);
  }
  const frondMat = new THREE.MeshLambertMaterial({ color: '#3f9a55', flatShading: true, side: THREE.DoubleSide });
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.2, 4), frondMat);
    frond.position.set(x, y, 0);
    frond.rotation.z = Math.PI / 2 - 0.5;
    frond.rotation.y = (i / fronds) * Math.PI * 2;
    frond.scale.set(0.5, 1, 0.18);
    g.add(frond);
  }
  // a couple of coconuts
  const coco = new THREE.MeshLambertMaterial({ color: '#5a3f28', flatShading: true });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), coco);
    c.position.set(x + (rand(seed + i) - 0.5) * 0.2, y - 0.1, (rand(seed + i * 2) - 0.5) * 0.2);
    g.add(c);
  }
  g.scale.setScalar(scale);
  return g;
}

// a low snow-capped bush: a couple of dark-green faceted blobs with white snow
// dolloped on top
function snowBush(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const green = new THREE.MeshLambertMaterial({ color: '#3f7a52', flatShading: true });
  const snow = new THREE.MeshLambertMaterial({ color: '#eef4fb', flatShading: true });
  const blobs = 2 + Math.floor(rand(seed) * 2);
  for (let i = 0; i < blobs; i++) {
    const r = 0.3 + rand(seed + i * 1.3) * 0.22;
    const x = (rand(seed + i * 2.1) - 0.5) * 0.55;
    const z = (rand(seed + i * 3.3) - 0.5) * 0.55;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), green);
    blob.position.set(x, r * 0.7, z);
    blob.scale.y = 0.85;
    g.add(blob);
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.72, 0), snow);
    cap.position.set(x, r * 1.05, z);
    cap.scale.set(1, 0.5, 1);
    g.add(cap);
  }
  g.scale.setScalar(scale);
  return g;
}

function buildSnow(): THREE.Group {
  const group = new THREE.Group();
  group.add(makeGround('#e9f1fb', 1.4, 4));

  // soft snow mounds dotted around
  const moundMat = new THREE.MeshLambertMaterial({ color: '#f3f8ff', flatShading: true });
  scatter(group, 16, 7, 30, 21, (i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.6 + rand(i) * 0.9, 8, 6), moundMat);
    m.scale.y = 0.4;
    m.position.y = -0.1;
    return m;
  });

  // pines in the mid-ground (kept off the character)
  scatter(group, 15, 13, 44, 5, (i) => pineTree(0.9 + rand(i) * 0.7, true));

  // snow-capped bushes dotting the ground for texture (green reads against snow)
  scatter(group, 30, 5, 48, 33, (i) => snowBush(0.85 + rand(i) * 0.6, i));

  // bluish ice rocks (cool tone contrasts the white snow)
  scatter(group, 16, 6, 36, 60, (i) => {
    const r = makeBoulder(0.45 + rand(i) * 0.5, i % 2 ? '#bcd2ea' : '#cadcef', 60 + i);
    r.position.y = 0.16;
    return r;
  });

  // gentle blue-shadowed snow drifts scattered wide — subtle tonal humps so the
  // flat white ground isn't a void
  const driftMat = new THREE.MeshLambertMaterial({ color: '#dbe8f6', flatShading: true });
  scatter(group, 46, 4, 56, 71, (i) => {
    const d = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4 + rand(i) * 0.55, 0), driftMat);
    d.scale.set(1.5, 0.32, 1.1);
    d.position.y = -0.08;
    return d;
  });

  // foreground framing: a big pine flanking the left + a boulder on the right
  const heroPine = pineTree(2.4, true);
  heroPine.position.set(-1.7, 0, -2.6);
  group.add(heroPine);
  const heroRock = makeBoulder(1.05, '#c2d6ea', 200);
  heroRock.position.set(2.0, 0.2, -1.9);
  group.add(heroRock);

  // a whole RANGE of distant snowy peaks ringing the horizon — many, smaller, far,
  // so they read as mountains on the skyline rather than one lone pyramid
  const peakSnow = new THREE.MeshLambertMaterial({ color: '#f2f7fd', flatShading: true });
  const peakRock = new THREE.MeshLambertMaterial({ color: '#c3d2e4', flatShading: true });
  scatter(group, 40, 100, 135, 90, (i) => {
    const h = 9 + rand(i) * 12;
    const r = 7 + rand(i * 2) * 8;
    const peak = new THREE.Group();
    const base = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6, 1), peakRock);
    base.position.y = h / 2 - 6;
    peak.add(base);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, h * 0.4, 6, 1), peakSnow);
    cap.position.y = h * 0.72 - 6;
    peak.add(cap);
    return peak;
  });

  return group;
}

const SNOW_PRESET: BiomePreset = {
  skyTop: '#78acdf',
  skyMid: '#bad6f0',
  skyHorizon: '#ecf4fb',
  fog: '#dce9f5',
  fogNear: 16,
  fogFar: 95,
  keyColor: '#ffffff',
  keyIntensity: 1.7,
  fillColor: '#cfe0ff',
  fillIntensity: 0.55,
  rimColor: '#ffffff',
  rimIntensity: 1.25,
  hemiSky: '#e8f2ff',
  hemiGround: '#b6c6da',
  hemiIntensity: 0.65,
  exposure: 1.02,
  keyDir: [-0.55, 0.6, 0.55],
  rimDir: [0.4, 0.5, -0.85],
  shadow: 0.55,
};

// ---- desert ----------------------------------------------------------------

// a barrel cactus: a tall trunk with 0–2 bent arms
function cactus(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#4f9e5a', flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.6, 8), mat);
  body.position.y = 0.8;
  body.castShadow = true;
  g.add(body);
  const arms = Math.floor(rand(seed) * 3); // 0–2
  for (let i = 0; i < arms; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const arm = new THREE.Group();
    const out = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.42, 7), mat);
    out.rotation.z = (side * Math.PI) / 2;
    out.position.set(side * 0.24, 0, 0);
    arm.add(out);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.5, 7), mat);
    up.position.set(side * 0.44, 0.34, 0);
    arm.add(up);
    arm.position.y = 0.7 + i * 0.4;
    g.add(arm);
  }
  g.scale.setScalar(scale);
  return g;
}

// a low elongated sand mound / mini-dune (faceted, slightly off the sand tone)
function sandMound(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: seed % 2 ? '#d9a869' : '#e6bd82', flatShading: true });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat);
  dome.scale.set(1.7, 0.32, 1.05);
  dome.position.y = -0.06;
  g.add(dome);
  g.scale.setScalar(scale);
  g.rotation.y = rand(seed) * Math.PI;
  return g;
}

// a small cluster of pebbles for ground texture
function pebbles(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const n = 3 + Math.floor(rand(seed) * 3);
  for (let i = 0; i < n; i++) {
    const r = makeBoulder(0.2 + rand(seed + i) * 0.22, i % 2 ? '#c58f57' : '#b97d47', seed + i * 5);
    r.position.set((rand(seed + i * 1.7) - 0.5) * 1.1, 0.06, (rand(seed + i * 2.9) - 0.5) * 1.1);
    g.add(r);
  }
  g.scale.setScalar(scale);
  return g;
}

// a dry desert shrub: sparse olive faceted blobs
function dryShrub(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#9a9a54', flatShading: true });
  const blobs = 2 + Math.floor(rand(seed) * 2);
  for (let i = 0; i < blobs; i++) {
    const r = 0.22 + rand(seed + i * 1.3) * 0.18;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    blob.position.set((rand(seed + i * 2.1) - 0.5) * 0.5, r * 0.8, (rand(seed + i * 3.3) - 0.5) * 0.5);
    blob.scale.y = 1.1;
    g.add(blob);
  }
  g.scale.setScalar(scale);
  return g;
}

function buildDesert(): THREE.Group {
  const group = new THREE.Group();
  group.add(makeGround('#e2b878', 1.4, 9));

  // cacti scattered on the sand (kept off the character, modest scale)
  scatter(group, 13, 13, 40, 7, (i) => cactus(0.8 + rand(i) * 0.5, i));

  // low sand mounds / mini-dunes rolling across the sand
  scatter(group, 16, 6, 50, 51, (i) => sandMound(0.9 + rand(i) * 0.8, i));

  // sandstone rocks / boulders (rounded, not boxy)
  scatter(group, 13, 10, 34, 40, (i) => {
    const r = makeBoulder(0.5 + rand(i) * 0.55, i % 2 ? '#c98a52' : '#d8a566', 40 + i);
    r.position.y = 0.16;
    return r;
  });

  // pebble clusters + dry shrubs peppering the ground for texture
  scatter(group, 20, 5, 52, 88, (i) => pebbles(0.8 + rand(i) * 0.7, i));
  scatter(group, 16, 6, 48, 63, (i) => dryShrub(0.8 + rand(i) * 0.6, i));

  // mid-distance mesas (flat-topped sandstone buttes), pushed back
  scatter(group, 7, 40, 72, 77, (i) => {
    const w = 5 + rand(i) * 6;
    const h = 4 + rand(i * 2) * 6;
    const mesa = makeRock(w, h, w * 0.8, i % 2 ? '#c47b46' : '#d69157', 77 + i);
    mesa.position.y = h / 2 - 1;
    return mesa;
  });

  // foreground framing: a tall hero cactus on the right + a boulder on the left
  const heroCactus = cactus(2.2, 200);
  heroCactus.position.set(1.9, 0, -2.5);
  group.add(heroCactus);
  const heroBoulder = makeBoulder(1.25, '#c98a52', 201);
  heroBoulder.position.set(-2.0, 0.2, -1.9);
  group.add(heroBoulder);

  // far mesa/butte silhouettes ringing the horizon — many, smaller, far
  const farMat = new THREE.MeshLambertMaterial({ color: '#dcae78', flatShading: true });
  scatter(group, 30, 100, 138, 120, (i) => {
    const h = 7 + rand(i) * 10;
    const r = 8 + rand(i * 2) * 10;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5, 1), farMat);
    m.position.y = h / 2 - 6;
    return m;
  });

  return group;
}

const DESERT_PRESET: BiomePreset = {
  skyTop: '#6ea6d6',
  skyMid: '#e9cb9c',
  skyHorizon: '#f7e8ca',
  fog: '#ecd6ac',
  fogNear: 18,
  fogFar: 105,
  keyColor: '#ffe7bb',
  keyIntensity: 1.95,
  fillColor: '#cdb890',
  fillIntensity: 0.45,
  rimColor: '#fff0d2',
  rimIntensity: 1.1,
  hemiSky: '#ffe7bd',
  hemiGround: '#a5814f',
  hemiIntensity: 0.5,
  exposure: 0.98,
  keyDir: [0.75, 0.32, 0.4],
  rimDir: [-0.4, 0.5, -0.85],
  shadow: 0.78,
};

// ---- forest (pinewood) -----------------------------------------------------

// a small mushroom: a stem + a rounded red/white cap
function mushroom(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.22, 6),
    new THREE.MeshLambertMaterial({ color: '#efe6d2', flatShading: true }),
  );
  stem.position.y = 0.11;
  g.add(stem);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: seed % 2 ? '#c0453a' : '#d98a3a', flatShading: true }),
  );
  cap.position.y = 0.22;
  cap.scale.y = 0.7;
  g.add(cap);
  g.scale.setScalar(scale);
  return g;
}

function buildForest(): THREE.Group {
  const group = new THREE.Group();
  group.add(makeGround('#4f8f3a', 1.1, 14));

  // dense conifers + round leafy trees, some close so they frame the character
  scatter(group, 26, 8, 46, 15, (i) => pineTree(1.0 + rand(i) * 0.9, false, i % 2 ? '#2f7a45' : '#367a3c'));
  scatter(group, 18, 9, 44, 23, (i) => leafyTree(0.9 + rand(i) * 0.7, i, i % 2 ? '#57a83f' : '#478f39'));

  // leafy ground bushes
  scatter(group, 26, 5, 50, 61, (i) => leafyTree(0.32 + rand(i) * 0.22, i + 5, '#3f8f3a'));

  // mossy boulders + toadstools for detail
  scatter(group, 12, 7, 40, 70, (i) => {
    const r = makeBoulder(0.5 + rand(i) * 0.5, i % 2 ? '#6f7d52' : '#7d8a5e', 70 + i);
    r.position.y = 0.16;
    return r;
  });
  scatter(group, 20, 5, 46, 88, (i) => mushroom(0.8 + rand(i) * 0.7, i));

  // foreground framing: a big canopy tree overhanging the left + a fern on the right
  const heroTree = leafyTree(2.4, 200, '#3f8f3a');
  heroTree.position.set(-1.8, 0, -2.7);
  group.add(heroTree);
  const heroFern = leafyTree(0.75, 201, '#57a83f');
  heroFern.position.set(2.0, 0, -1.7);
  group.add(heroFern);

  // darker forested hills on the horizon
  const hillMat = new THREE.MeshLambertMaterial({ color: '#3c6e34', flatShading: true });
  scatter(group, 26, 95, 135, 90, (i) => {
    const r = 12 + rand(i) * 14;
    const h = 8 + rand(i * 2) * 8;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hillMat);
    m.scale.y = h / r / 2;
    m.position.y = -6;
    return m;
  });

  return group;
}

const FOREST_PRESET: BiomePreset = {
  skyTop: '#5f9bd6',
  skyMid: '#9fc98e',
  skyHorizon: '#dcefcf',
  fog: '#cfe4c8',
  fogNear: 14,
  fogFar: 78,
  keyColor: '#fff2d8',
  keyIntensity: 1.4,
  fillColor: '#bcd6a8',
  fillIntensity: 0.5,
  rimColor: '#eafff0',
  rimIntensity: 1.0,
  hemiSky: '#d8f0d0',
  hemiGround: '#455829',
  hemiIntensity: 0.5,
  exposure: 0.95,
  keyDir: [-0.4, 0.78, 0.42],
  rimDir: [0.45, 0.55, -0.8],
  shadow: 0.55,
};

// ---- blossom (cherry-blossom vale) -----------------------------------------

// a cherry tree: a dark trunk under a wide, soft-pink canopy
function blossomTree(scale: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.17, 1.1, 6),
    new THREE.MeshLambertMaterial({ color: '#4f382a', flatShading: true }),
  );
  trunk.position.y = 0.55;
  g.add(trunk);
  const pinks = ['#f7b8d2', '#f4a9c8', '#ffc9dd'];
  const blobs = 4 + Math.floor(rand(seed) * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 0.5 + rand(seed + i) * 0.4;
    const mat = new THREE.MeshLambertMaterial({ color: pinks[i % pinks.length], flatShading: true });
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    blob.position.set(
      (rand(seed + i * 2) - 0.5) * 1.0,
      1.15 + rand(seed + i * 3) * 0.5,
      (rand(seed + i * 4) - 0.5) * 1.0,
    );
    blob.scale.y = 0.85;
    blob.castShadow = true;
    g.add(blob);
  }
  g.scale.setScalar(scale);
  return g;
}

function buildBlossom(): THREE.Group {
  const group = new THREE.Group();
  // warm orange earth under the pink canopy (matches the world-map island art)
  group.add(makeGround('#d99a5e', 0.9, 27));

  // cherry trees of various sizes, some close so they frame the character
  scatter(group, 24, 8, 48, 4, (i) => blossomTree(0.9 + rand(i) * 0.9, i));

  // low pink shrubs + soft petal patches on the ground
  scatter(group, 24, 5, 50, 41, (i) => leafyTree(0.3 + rand(i) * 0.2, i, i % 2 ? '#f4a9c8' : '#f7b8d2'));
  const petalMat = new THREE.MeshLambertMaterial({ color: '#f9cfe0', flatShading: true });
  scatter(group, 40, 4, 54, 66, (i) => {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + rand(i) * 0.4, 0), petalMat);
    p.scale.set(1.4, 0.18, 1.2);
    p.position.y = -0.05;
    return p;
  });

  // mossy rocks for grounding
  scatter(group, 10, 8, 40, 77, (i) => {
    const r = makeBoulder(0.45 + rand(i) * 0.45, '#8a8f70', 77 + i);
    r.position.y = 0.14;
    return r;
  });

  // foreground framing: a big cherry tree arching over from the right
  const heroCherry = blossomTree(2.4, 200);
  heroCherry.position.set(1.9, 0, -2.7);
  group.add(heroCherry);
  const heroRock = makeBoulder(0.9, '#8a8f70', 201);
  heroRock.position.set(-2.0, 0.2, -1.7);
  group.add(heroRock);

  // pink-canopied hills on the horizon
  const hillMat = new THREE.MeshLambertMaterial({ color: '#e79ec0', flatShading: true });
  scatter(group, 24, 95, 135, 120, (i) => {
    const r = 12 + rand(i) * 14;
    const h = 7 + rand(i * 2) * 7;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hillMat);
    m.scale.y = h / r / 2;
    m.position.y = -6;
    return m;
  });

  return group;
}

const BLOSSOM_PRESET: BiomePreset = {
  skyTop: '#86a8e0',
  skyMid: '#f0c0d8',
  skyHorizon: '#ffe6ee',
  fog: '#f6d8e4',
  fogNear: 14,
  fogFar: 85,
  keyColor: '#fff0f2',
  keyIntensity: 1.6,
  fillColor: '#e8c8dc',
  fillIntensity: 0.5,
  rimColor: '#ffffff',
  rimIntensity: 1.1,
  hemiSky: '#ffe4ee',
  hemiGround: '#8a6a58',
  hemiIntensity: 0.55,
  exposure: 1.02,
  keyDir: [0.5, 0.55, 0.5],
  rimDir: [-0.4, 0.6, -0.8],
  shadow: 0.45,
};

// ---- tropical (palm cove) --------------------------------------------------

function buildTropical(): THREE.Group {
  const group = new THREE.Group();
  // lush lawn with sandy accents (matches the world-map island art)
  group.add(makeGround('#7cbf52', 0.7, 31));

  // ocean: a big glossy plane ringing the far distance.
  // expo-gl: MeshStandardMaterial — will pick up scene.environment (PMREM) as a
  // reflection. fog:false keeps the water from hazing (see patchWorldFog note).
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: '#2fa8c8',
      roughness: 0.35,
      metalness: 0.1,
      emissive: '#1f88b0',
      emissiveIntensity: 0.25,
      fog: false,
    }),
  );
  water.position.set(0, -0.6, -70);
  group.add(water);

  // palms clustered like a little grove
  scatter(group, 12, 12, 46, 7, (i) => palmTree(1.0 + rand(i) * 0.7, i));

  // tropical shrubs + beach rocks + a few shells
  scatter(group, 20, 5, 48, 52, (i) => leafyTree(0.34 + rand(i) * 0.24, i, i % 2 ? '#3f9a55' : '#57ab63'));
  scatter(group, 12, 7, 42, 40, (i) => {
    const r = makeBoulder(0.4 + rand(i) * 0.45, i % 2 ? '#c9b58a' : '#b7a074', 40 + i);
    r.position.y = 0.12;
    return r;
  });

  // foreground framing: a big leaning palm anchoring the left + a beach rock right
  const heroPalm = palmTree(2.2, 200);
  heroPalm.position.set(-1.8, 0, -2.7);
  group.add(heroPalm);
  const heroRock = makeBoulder(1.05, '#c9b58a', 201);
  heroRock.position.set(2.0, 0.15, -1.7);
  group.add(heroRock);

  // distant tiny palm islands on the water
  scatter(group, 8, 60, 90, 99, (i) => {
    const island = new THREE.Group();
    const sand = new THREE.Mesh(
      new THREE.SphereGeometry(4 + rand(i) * 3, 10, 6),
      new THREE.MeshLambertMaterial({ color: '#e6c98a', flatShading: true }),
    );
    sand.scale.y = 0.18;
    sand.position.y = -0.3;
    island.add(sand);
    island.add(palmTree(1.4 + rand(i) * 0.6, i + 3));
    return island;
  });

  return group;
}

const TROPICAL_PRESET: BiomePreset = {
  skyTop: '#2f8fd0',
  skyMid: '#7fc6e8',
  skyHorizon: '#d6f2f4',
  fog: '#cdeef2',
  fogNear: 20,
  fogFar: 120,
  keyColor: '#fff6dc',
  keyIntensity: 1.9,
  fillColor: '#bfe6f0',
  fillIntensity: 0.5,
  rimColor: '#ffffff',
  rimIntensity: 1.2,
  hemiSky: '#dcf4ff',
  hemiGround: '#9c8c5c',
  hemiIntensity: 0.6,
  exposure: 1.02,
  keyDir: [0.6, 0.66, 0.38],
  rimDir: [-0.4, 0.5, -0.85],
  shadow: 0.6,
};

// ---- volcano (mount ember) -------------------------------------------------

function buildVolcano(): THREE.Group {
  const group = new THREE.Group();
  group.add(makeGround('#463b42', 1.6, 44)); // dark ashen rock (a touch lighter so it reads)

  // glowing lava pools (emissive discs sitting on the ground), some right by the
  // character. fog:false so the glow reads even through the smoky haze.
  const lavaMat = new THREE.MeshBasicMaterial({ color: '#ff8330', fog: false });
  scatter(group, 22, 4, 50, 55, (i) => {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.7 + rand(i) * 1.6, 8).rotateX(-Math.PI / 2), lavaMat);
    pool.position.y = 0.03;
    return pool;
  });

  // jagged black basalt rocks
  scatter(group, 18, 6, 48, 40, (i) => {
    const r = makeBoulder(0.55 + rand(i) * 0.7, i % 2 ? '#2a2429' : '#37303a', 40 + i);
    r.position.y = 0.18;
    return r;
  });

  // charred dead pines
  scatter(group, 10, 10, 44, 12, (i) => pineTree(0.9 + rand(i) * 0.6, false, '#241d22'));

  // glowing ember veins snaking across the ground
  const emberMat = new THREE.MeshBasicMaterial({ color: '#ff5a1e', fog: false });
  scatter(group, 34, 4, 52, 71, (i) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.14 + rand(i) * 0.24, 0.06, 0.5 + rand(i) * 0.7), emberMat);
    e.position.y = 0.03;
    return e;
  });

  // the smoking volcano — a dark silhouette peak on the horizon whose lava GLOWS
  // through the haze (fog:false on the emissive bits)
  // warm dark-red rock (fog:false so it stays a legible volcanic mass instead of
  // hazing to brown) with lava on its face
  const rockMat = new THREE.MeshLambertMaterial({ color: '#4a2a29', flatShading: true, fog: false });
  const glow = (hex: string) => new THREE.MeshBasicMaterial({ color: hex, fog: false });
  const volcano = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(24, 30, 7, 1), rockMat);
  cone.position.y = 30 / 2 - 6;
  volcano.add(cone);
  // glowing crater lake nested in the cone's top
  const crater = new THREE.Mesh(new THREE.CircleGeometry(7, 8), glow('#ffbb4a'));
  crater.rotation.x = -Math.PI / 2 + 0.55;
  crater.position.set(0, 30 - 6 - 3, 6.5);
  volcano.add(crater);
  // lava streaks spilling from the crater down the camera-facing flank
  for (let i = 0; i < 4; i++) {
    const streak = new THREE.Mesh(new THREE.BoxGeometry(0.8 + rand(i) * 0.6, 18, 0.5), glow('#ff7328'));
    streak.position.set((i - 1.5) * 3.4, 8, 14 - Math.abs(i - 1.5) * 1.2);
    streak.rotation.x = 0.42;
    volcano.add(streak);
  }
  // a smoke plume rising from the crater
  const smokeMat = new THREE.MeshLambertMaterial({
    color: '#6a5f5f',
    transparent: true,
    opacity: 0.7,
    flatShading: true,
    fog: false,
  });
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(3.5 + i * 1.5, 0), smokeMat);
    puff.position.set((rand(i) - 0.5) * 5, 26 + i * 4.5, 5);
    volcano.add(puff);
  }
  volcano.position.set(-14, 0, -124); // off-centre for a stronger composition
  group.add(volcano);

  // foreground framing: jagged basalt rocks flanking the shot
  const fgRockL = makeBoulder(1.4, '#2a2429', 200);
  fgRockL.position.set(-2.0, 0.2, -1.8);
  group.add(fgRockL);
  const fgRockR = makeBoulder(1.55, '#37303a', 201);
  fgRockR.position.set(2.1, 0.2, -1.9);
  group.add(fgRockR);

  const peakMat = new THREE.MeshLambertMaterial({ color: '#332a30', flatShading: true });
  scatter(group, 22, 95, 145, 90, (i) => {
    const r = 10 + rand(i) * 12;
    const h = 12 + rand(i * 2) * 14;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6, 1), peakMat);
    m.position.y = h / 2 - 6;
    return m;
  });

  return group;
}

const VOLCANO_PRESET: BiomePreset = {
  skyTop: '#2a1420',
  skyMid: '#9c3a2a',
  skyHorizon: '#f4913f',
  fog: '#6e352a',
  fogNear: 14,
  fogFar: 90,
  keyColor: '#ff9a5a',
  keyIntensity: 1.5,
  fillColor: '#b04a3a',
  fillIntensity: 0.45,
  rimColor: '#ff7a3a',
  rimIntensity: 1.3,
  hemiSky: '#a04030',
  hemiGround: '#201014',
  hemiIntensity: 0.5,
  exposure: 1.05,
  keyDir: [0.4, 0.3, 0.6],
  rimDir: [0.35, 0.55, -0.85],
  shadow: 0.45,
};

export const BIOMES: Record<BiomeId, Biome> = {
  snow: { preset: SNOW_PRESET, build: buildSnow },
  desert: { preset: DESERT_PRESET, build: buildDesert },
  forest: { preset: FOREST_PRESET, build: buildForest },
  blossom: { preset: BLOSSOM_PRESET, build: buildBlossom },
  tropical: { preset: TROPICAL_PRESET, build: buildTropical },
  volcano: { preset: VOLCANO_PRESET, build: buildVolcano },
};

// ---- time-of-day modulation for biomes ------------------------------------
// Biome presets are authored as a bright "day" look. Rather than hand-paint a
// separate evening/night preset for all six, derive them procedurally: blend
// each look toward a shared dusk / night mood and scale the light intensities +
// exposure. Every biome becomes time-of-day aware from one place — tune the two
// factor tables below (and VERIFY on a physical device; the simulator's GL lies).

const _a = new THREE.Color();
const _b = new THREE.Color();
// blend `hex` toward `target` by t (0..1) → hex string
function mix(hex: string, target: string, t: number): string {
  _a.set(hex);
  _b.set(target);
  return '#' + _a.lerp(_b, t).getHexString();
}
// scale a color's brightness toward black → hex string
function dim(hex: string, f: number): string {
  return '#' + _a.set(hex).multiplyScalar(f).getHexString();
}

// [tint, mixAmount] blends a color; light entries add an intensity multiplier
// (and rim adds a floor so dusk/night always get a little backlight).
type TodMod = {
  skyTop: [string, number];
  skyMid: [string, number];
  skyHorizon: [string, number];
  skyDim: number;
  fog: [string, number];
  fogFar: number; // multiplier
  key: [string, number, number]; // tint, mix, intensity×
  fill: [string, number, number];
  rim: [string, number, number, number]; // tint, mix, intensity×, floor
  hemiSky: [string, number];
  hemiGround: [string, number];
  hemiScale: number;
  exposure: number; // multiplier
};

const TOD_MOD: Record<Exclude<TimeOfDay, 'day'>, TodMod> = {
  evening: {
    skyTop: ['#40407a', 0.35],
    skyMid: ['#e8a877', 0.4],
    skyHorizon: ['#ffd28a', 0.45],
    skyDim: 0.92,
    fog: ['#e8a877', 0.5],
    fogFar: 1,
    key: ['#ffb257', 0.5, 0.9],
    fill: ['#6a6bb0', 0.3, 0.95],
    rim: ['#ff6a1a', 0.5, 1, 0.4],
    hemiSky: ['#ffcf9a', 0.4],
    hemiGround: ['#3a3560', 0.3],
    hemiScale: 0.8,
    exposure: 0.96,
  },
  night: {
    skyTop: ['#0c0a29', 0.6],
    skyMid: ['#2c1a47', 0.55],
    skyHorizon: ['#3b2a5d', 0.5],
    skyDim: 0.55,
    fog: ['#26355c', 0.6],
    fogFar: 0.6,
    key: ['#4f7aff', 0.6, 0.55],
    fill: ['#3a4a80', 0.5, 0.8],
    rim: ['#2a5aff', 0.5, 0.5, 0.1],
    hemiSky: ['#2a3a66', 0.6],
    hemiGround: ['#0f1529', 0.6],
    hemiScale: 0.5,
    exposure: 2.0,
  },
};

/**
 * A biome's look for a given time of day. `day` returns the authored preset
 * unchanged; `evening`/`night` blend it toward the dusk/night mood above. The
 * ground geometry is time-independent (built once) — only the sky/fog/light rig
 * this returns changes, so the renderer re-derives it on travel + on clock ticks.
 */
export function biomeLookForTime(base: BiomePreset, tod: TimeOfDay): BiomePreset {
  if (tod === 'day') {
    return base;
  }
  const m = TOD_MOD[tod];
  return {
    ...base,
    skyTop: dim(mix(base.skyTop, m.skyTop[0], m.skyTop[1]), m.skyDim),
    skyMid: dim(mix(base.skyMid, m.skyMid[0], m.skyMid[1]), m.skyDim),
    skyHorizon: dim(mix(base.skyHorizon, m.skyHorizon[0], m.skyHorizon[1]), m.skyDim),
    fog: mix(base.fog, m.fog[0], m.fog[1]),
    fogFar: base.fogFar * m.fogFar,
    keyColor: mix(base.keyColor, m.key[0], m.key[1]),
    keyIntensity: base.keyIntensity * m.key[2],
    fillColor: mix(base.fillColor, m.fill[0], m.fill[1]),
    fillIntensity: base.fillIntensity * m.fill[2],
    rimColor: mix(base.rimColor, m.rim[0], m.rim[1]),
    rimIntensity: Math.max(base.rimIntensity * m.rim[2], m.rim[3]),
    hemiSky: mix(base.hemiSky, m.hemiSky[0], m.hemiSky[1]),
    hemiGround: mix(base.hemiGround, m.hemiGround[0], m.hemiGround[1]),
    hemiIntensity: base.hemiIntensity * m.hemiScale,
    exposure: base.exposure * m.exposure,
  };
}

// island id → travel environment (the session-complete "see the island" hop).
// Ported from web's world-map.tsx AREA_BIOME, which derived this from the AREAS
// list; inlined here so the biome module owns its own island mapping and the
// world map just consumes it.
export const AREA_BIOME: Record<string, EnvironmentId> = {
  frostpeak: 'snow',
  pinewood: 'forest',
  blossom: 'blossom',
  dunes: 'desert',
  palmcove: 'tropical',
  ember: 'volcano',
};

// One low hill on the RIGHT of the home composition (9:16 portrait), its left
// slope descending as a diagonal that converges just past screen-centre — a
// simple bit of background depth to sit the character against (and to fall out
// of focus under the DoF). A couple of trees on the slope. Flat-shaded, no
// shadows. Parented to the grass group in the renderer so it shows on the meadow
// and hides during travel. `hillColor` should match the foreground grass-hill.
export type BackdropParams = {
  x: number;
  z: number;
  radius: number;
  flat: number;
  sink: number;
  hillColor: string;
  treeColor: string;
  // bright grass-tip green — the cap tufts tint toward it (tips dominate at distance)
  tipColor: string;
  // distant-ridge controls (live-tunable) + the per-scene colour they haze toward
  ridgeHeight: number;
  ridgeHaze: number;
  ridgeDepth: number;
  hazeColor: string;
};

type Lobe = { x: number; y: number; z: number; rx: number; ry: number; rz: number };

// Merge a set of overlapping ellipsoid lobes into ONE cel mesh. Merging (rather
// than separate meshes) is what makes a mass read as a single soft form instead
// of spheres with hard grey creases at every overlap — same trick the clouds use.
function lobeMesh(lobes: Lobe[], mat: THREE.Material, detail: number): THREE.Mesh {
  const geos = lobes.map((l) => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.scale(l.rx, l.ry, l.rz);
    g.translate(l.x, l.y, l.z);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const m = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), mat);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

// Built with the character's own cel shader (passed in as `makeMat`) and SMOOTH
// normals — low-poly geometry that renders as soft cinematic cel forms, not
// faceted blobs. It layers depth: a few RECEDING RIDGES of irregular merged lobes
// hazing toward the scene's horizon colour (atmospheric perspective → reads as a
// big world; per time-of-day for free), the tunable "hero" hill on the right (also
// irregular lobes, not a ball), grass on its cap, and a couple of trees.
export function makeMeadowBackdrop(
  p: BackdropParams,
  makeMat: (color: string) => THREE.Material,
): THREE.Group {
  const group = new THREE.Group();

  // --- distant ridges: 3 bands receding behind the character, each hazed further
  // toward the scene haze colour + placed deeper so the fog fades them into the
  // sky. ridgeHeight/Depth/Haze scale the whole set live. Lobe heights vary per
  // band for a natural, non-uniform horizon silhouette.
  const bands = [
    { z: -20, yb: -2.2, span: 42, n: 8, peak: 4.2, t: 0.16 },
    { z: -32, yb: -1.6, span: 56, n: 10, peak: 3.4, t: 0.42 },
    { z: -46, yb: -1.0, span: 72, n: 12, peak: 2.7, t: 0.66 },
  ];
  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    const lobes: Lobe[] = [];
    for (let i = 0; i < band.n; i++) {
      const fx = (i / (band.n - 1) - 0.5) * band.span + (rand(b * 17 + i) - 0.5) * 4;
      const h = band.peak * p.ridgeHeight * (0.55 + rand(b * 7 + i * 2) * 0.75); // height variance
      const w = h * (1.5 + rand(b * 5 + i * 3) * 1.0);
      const z = band.z * p.ridgeDepth + (rand(b * 3 + i) - 0.5) * 6;
      lobes.push({ x: fx, y: band.yb, z, rx: w, ry: h, rz: w * 0.7 });
    }
    const t = Math.min(0.94, band.t * p.ridgeHaze);
    group.add(lobeMesh(lobes, makeMat(mix(p.hillColor, p.hazeColor, t)), 1));
  }

  // --- hero hill (irregular merged lobes, not a ball): a main dome + shoulders,
  // built from the tunable params so the Backdrop sliders still shape it.
  const R = p.radius;
  const F = p.flat;
  const S = p.sink;
  group.add(
    lobeMesh(
      [
        { x: p.x, y: -S, z: p.z, rx: R, ry: R * F, rz: R },
        { x: p.x - R * 0.72, y: -S * 1.12, z: p.z + R * 0.22, rx: R * 0.62, ry: R * F * 0.82, rz: R * 0.7 },
        { x: p.x + R * 0.55, y: -S * 0.95, z: p.z - R * 0.16, rx: R * 0.72, ry: R * F * 1.06, rz: R * 0.76 },
        { x: p.x - R * 0.28, y: -S, z: p.z - R * 0.42, rx: R * 0.5, ry: R * F * 0.72, rz: R * 0.56 },
      ],
      makeMat(p.hillColor),
      2,
    ),
  );

  // world Y of the hero cap surface at horizontal distance dh from its centre
  const capY = (dh: number) => -p.sink + p.radius * p.flat * Math.sqrt(Math.max(0, 1 - (dh / p.radius) ** 2));

  // grass on the cap — faked to read like the foreground lawn from ~4× the
  // camera distance: blades sized ~2–2.5× the foreground's world size (so they
  // still render smaller on screen), gathered into tuft pockets like the lawn's
  // clump centres, and tinted per tuft from three base→tip mixes (bright tips
  // dominate a lawn seen from afar) with a touch of haze for aerial perspective.
  // Baked into THREE merged meshes (one per tint) — 3 draw calls, same geometry
  // budget as before.
  const bladeSrc = new THREE.ConeGeometry(0.028, 0.34, 3);
  bladeSrc.translate(0, 0.17, 0);
  const bladeTints = [0.3, 0.55, 0.8].map((t) => mix(mix(p.treeColor, p.tipColor, t), p.hazeColor, 0.12));
  const blades: THREE.BufferGeometry[][] = bladeTints.map(() => []);
  const mtx = new THREE.Matrix4();
  const qt = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const axis = new THREE.Vector3();
  // tuft pockets on the visible cap, each owning one of the three tints
  type Tuft = { x: number; z: number; r: number; tint: number };
  const tufts: Tuft[] = [];
  for (let i = 0; tufts.length < 14 && i < 60; i++) {
    const a = rand(i * 6.7 + 2) * Math.PI * 2;
    const dh = Math.sqrt(rand(i * 8.3 + 5)) * p.radius * 0.82;
    if (capY(dh) < 0.06) continue;
    tufts.push({
      x: Math.cos(a) * dh,
      z: Math.sin(a) * dh,
      r: 0.35 + rand(i * 9.1 + 3) * 0.45,
      tint: Math.floor(rand(i * 4.9 + 7) * bladeTints.length),
    });
  }
  const TARGET = 190;
  let placed = 0;
  for (let i = 0; placed < TARGET && i < TARGET * 4; i++) {
    // ~3/4 of blades gather in tufts, the rest scatter loose between them
    const tuft = rand(i * 2.9 + 1) < 0.75 && tufts.length ? tufts[Math.floor(rand(i * 7.7 + 4) * tufts.length)] : null;
    let dx: number;
    let dz: number;
    if (tuft) {
      const cr = tuft.r * Math.sqrt(rand(i * 2.1));
      const ca = rand(i * 1.3) * Math.PI * 2;
      dx = tuft.x + Math.cos(ca) * cr;
      dz = tuft.z + Math.sin(ca) * cr;
    } else {
      const a = rand(i * 1.3) * Math.PI * 2;
      const dh = Math.sqrt(rand(i * 2.1)) * p.radius * 0.9;
      dx = Math.cos(a) * dh;
      dz = Math.sin(a) * dh;
    }
    const dh = Math.hypot(dx, dz);
    const y = capY(dh);
    if (y < 0.03) continue; // only where the cap clears the ground
    pos.set(p.x + dx, y - 0.015, p.z + dz); // slight sink so tilted bases don't gap
    // tuft members share the tuft's scale mood; loose blades run shorter
    const sc = (tuft ? 0.7 + rand(i * 3.7) * 0.5 : 0.5 + rand(i * 3.7) * 0.4) * (0.75 + rand(i * 4.2) * 0.5);
    scl.set(sc, sc * (0.8 + rand(i * 6.3) * 0.5), sc);
    axis.set(Math.cos(rand(i * 5.9) * Math.PI * 2), 0, Math.sin(rand(i * 5.9) * Math.PI * 2));
    qt.setFromAxisAngle(axis, (rand(i * 5.1) - 0.5) * 0.5);
    const bucket = tuft ? tuft.tint : Math.floor(rand(i * 3.3 + 6) * bladeTints.length);
    blades[bucket].push(bladeSrc.clone().applyMatrix4(mtx.compose(pos, qt, scl)));
    placed++;
  }
  bladeSrc.dispose();
  for (let b = 0; b < blades.length; b++) {
    if (!blades[b].length) continue;
    const merged = mergeGeometries(blades[b], false);
    blades[b].forEach((g) => g.dispose());
    if (merged) {
      const grass = new THREE.Mesh(merged, makeMat(bladeTints[b]));
      grass.castShadow = false;
      grass.receiveShadow = false;
      group.add(grass);
    }
  }

  // two round cel-shaded trees on the slope (smooth blobs), offset from the hill
  // centre + scaled with its radius so they track it on reposition/resize
  const rk = p.radius / 8;
  const spots: [number, number, number][] = [
    [-2.4 * rk, 1.4 * rk, 0.95 * rk], // lower on the slope, toward centre
    [-0.6 * rk, -0.8 * rk, 1.15 * rk], // higher, nearer the crest
  ];
  const trunkMat = makeMat('#6b4a2f');
  const leafMat = makeMat(p.treeColor);
  for (let i = 0; i < spots.length; i++) {
    const [ox, oz, scale] = spots[i];
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 1.0, 8), trunkMat);
    trunk.position.y = 0.5;
    t.add(trunk);
    for (let b = 0; b < 3; b++) {
      const r = 0.5 + rand(i * 3 + b) * 0.3;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), leafMat); // detail 2 = smooth silhouette
      blob.position.set((rand(i + b) - 0.5) * 0.6, 1.1 + b * 0.4, (rand(i + b * 2) - 0.5) * 0.6);
      blob.scale.y = 0.92;
      t.add(blob);
    }
    t.scale.setScalar(scale);
    t.position.set(p.x + ox, capY(Math.hypot(ox, oz)) - 0.15 * rk, p.z + oz);
    t.traverse((o) => {
      o.castShadow = false;
      (o as THREE.Mesh).receiveShadow = false;
    });
    group.add(t);
  }

  return group;
}
