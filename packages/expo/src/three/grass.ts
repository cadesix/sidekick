import * as THREE from 'three';

// Ported from sidekick/src/components/sidekick-grass.ts: the painterly storybook
// lawn — a domed hill with broad vertex-color bands, art-directed instanced
// grass (dense tufts near the character thinning toward the horizon), scattered
// daisies/buttercups and rocks, plus drifting low-poly cumulus clouds.
//
// expo-gl deltas from the web version:
//  - The web blade material was MeshLambertMaterial + an onBeforeCompile
//    injection. Custom injections are unreliable on expo-gl, so the blades are
//    a self-contained ShaderMaterial (unlit height ramp × uLightScale, with the
//    standard fog/tonemapping/colorspace chunks). The wind/trample/patch-tone
//    vertex math is verbatim.
//  - The daisy sprite was drawn on a DOM canvas; here it's rasterized into a
//    DataTexture with plain pixel math.
//  - setOpacity() fades every meadow material together (the Shop's meadow →
//    studio crossfade drives it every frame).

// gently domed lawn: crest at the origin where the character stands
const GROUND_CURVE = 0.012;
export const groundY = (x: number, z: number) => -GROUND_CURVE * (x * x + z * z);

const GRASS_HILL = '#57a336';
const GRASS_BASE = '#4f9a2c';
const GRASS_TIP = '#93cf4f';
const GRASS_SHADOW = '#2c6b1c';
const TALLEST = 0.15; // used to normalize height frac in the shader

export type GrassEnv = {
  group: THREE.Group;
  // call per frame: t in seconds, charPos = character root world position
  update: (t: number, charPos: THREE.Vector3) => void;
  setColors: (hill: string, base: string, tip: string, rock?: string) => void;
  // feed the blade shader the same light rig as the scene (preset-driven)
  setLights: (rig: {
    hemiSky: string;
    hemiGround: string;
    hemiIntensity: number;
    keyColor: string;
    keyIntensity: number;
    fillColor: string;
    fillIntensity: number;
    rimColor: string;
    rimIntensity: number;
  }) => void;
  relayout: (height: number, clumping: number) => void;
  // 1 = full meadow, 0 = fully faded out (Shop studio crossfade)
  setOpacity: (o: number) => void;
};

// a tapered, slightly-curled blade card (verbatim from web)
function makeBlade(height: number, width: number, curve: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 1, 3);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / height;
    pos.setX(i, pos.getX(i) * (1 - 0.9 * h * h)); // taper to a soft point
    pos.setZ(i, h * h * curve); // natural forward curl
  }
  geo.computeVertexNormals();
  return geo;
}

// Self-contained instanced blade shader: same wind sway, per-patch tone cells,
// trample-away-from-feet and height ramp (shadow → base → tip) as the web
// injection. Lighting reproduces MeshLambertMaterial exactly — hemisphere +
// key/fill/rim directional irradiance × 1/π against the blade card normal —
// driven by the same time-of-day preset as the web light rig, so the field
// picks up the warm sunlit brightness instead of a flat constant.
const BLADE_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec3 uPush;
varying float vHFrac;
varying float vTint;
varying float vTone;
varying vec3 vWN;
float hash2( vec2 p ){ return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
void main() {
	vec3 transformed = position;
	vHFrac = clamp( transformed.y / ${TALLEST.toFixed(3)}, 0.0, 1.0 );
	#ifdef USE_INSTANCING
	vec4 wpos = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
	vWN = normalize( mat3( modelMatrix ) * ( mat3( instanceMatrix ) * normal ) );
	#else
	vec4 wpos = modelMatrix * vec4( transformed, 1.0 );
	vWN = normalize( mat3( modelMatrix ) * normal );
	#endif
	float ph = wpos.x * 13.7 + wpos.z * 9.3;
	// patchy tone: cells of ~1.6 units share a green → broad color patches
	vTone = hash2( floor( wpos.xz / 1.6 ) );
	vTint = 0.9 + 0.2 * fract( sin( ph ) * 43758.5453 );
	float bend = vHFrac * vHFrac;
	wpos.x += ( sin( uTime * 1.6 + ph ) * 0.7 + sin( uTime * 2.8 + ph * 1.31 ) * 0.3 ) * 0.02 * bend;
	wpos.z += cos( uTime * 1.3 + ph * 0.7 ) * 0.012 * bend;
	// trample: blades near the character bend away from his feet
	vec2 away = wpos.xz - uPush.xz;
	float push = ( 1.0 - smoothstep( 0.06, 0.42, length( away ) ) )
		* ( 1.0 - smoothstep( 0.02, 0.18, uPush.y ) );
	wpos.xz += normalize( away + vec2( 1e-5 ) ) * push * 0.1 * vHFrac;
	wpos.y -= push * 0.035 * vHFrac;
	vec4 mvPosition = viewMatrix * wpos;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const BLADE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uShadow;
uniform vec3 uBase;
uniform vec3 uTip;
uniform float uOpacity;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform vec3 uKeyColor;
uniform vec3 uKeyDir;
uniform vec3 uFillColor;
uniform vec3 uFillDir;
uniform vec3 uRimColor;
uniform vec3 uRimDir;
varying float vHFrac;
varying float vTint;
varying float vTone;
varying vec3 vWN;
void main() {
	// dark base band (fake AO/shadow) → base green → bright tip
	vec3 g = mix( uShadow, uBase, smoothstep( 0.0, 0.38, vHFrac ) );
	g = mix( g, uTip, smoothstep( 0.45, 1.0, vHFrac ) );
	// patchy tone shift toward warm-lime or cool-olive per patch
	g = mix( g * vec3( 0.86, 0.94, 0.72 ), g * vec3( 1.08, 1.04, 0.86 ), vTone );
	// MeshLambertMaterial's exact irradiance: hemisphere + Σ dotNL·light, then
	// the Lambert BRDF's 1/π (light colors arrive premultiplied by intensity)
	vec3 N = normalize( vWN );
	if ( ! gl_FrontFacing ) N = -N;
	vec3 irr = mix( uHemiGround, uHemiSky, N.y * 0.5 + 0.5 );
	irr += uKeyColor * max( dot( N, uKeyDir ), 0.0 );
	irr += uFillColor * max( dot( N, uFillDir ), 0.0 );
	irr += uRimColor * max( dot( N, uRimDir ), 0.0 );
	gl_FragColor = vec4( g * vTint * irr * RECIPROCAL_PI, uOpacity );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

export function makeGrassEnvironment(blades = 20000, radius = 11): GrassEnv {
  const group = new THREE.Group();

  // ---- lawn dome, with broad low-frequency color bands in vertex color -------
  const hillGeo = new THREE.PlaneGeometry(80, 80, 96, 96).rotateX(-Math.PI / 2);
  const hp = hillGeo.attributes.position;
  const hillCol = new Float32Array(hp.count * 3);
  const cHill = new THREE.Color(GRASS_HILL);
  const cShad = new THREE.Color(GRASS_SHADOW);
  const cTmp = new THREE.Color();
  for (let i = 0; i < hp.count; i++) {
    const gx = hp.getX(i);
    const gz = hp.getZ(i);
    hp.setY(i, groundY(gx, gz));
    // two low-freq waves → soft broad bands of slightly darker/lighter green
    const band = 0.5 + 0.5 * Math.sin(gx * 0.22 + Math.cos(gz * 0.17) * 1.6);
    cTmp.copy(cHill).lerp(cShad, band * 0.28);
    cTmp.toArray(hillCol, i * 3);
  }
  hillGeo.setAttribute('color', new THREE.BufferAttribute(hillCol, 3));
  hillGeo.computeVertexNormals();
  const hillMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hill = new THREE.Mesh(hillGeo, hillMat);
  group.add(hill);

  // ---- shared cel-flat blade material ----------------------------------------
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uPush: { value: new THREE.Vector3(0, 0, 0) },
    uShadow: { value: new THREE.Color(GRASS_SHADOW) },
    uBase: { value: new THREE.Color(GRASS_BASE) },
    uTip: { value: new THREE.Color(GRASS_TIP) },
    uOpacity: { value: 1 },
    // light rig (colors premultiplied by intensity; dirs match the scene's
    // key/fill/rim placement in renderer.ts) — overwritten by setLights()
    uHemiSky: { value: new THREE.Color('#dcefff').multiplyScalar(0.55) },
    uHemiGround: { value: new THREE.Color('#8a9560').multiplyScalar(0.55) },
    uKeyColor: { value: new THREE.Color('#fff4dc').multiplyScalar(1.5) },
    uKeyDir: { value: new THREE.Vector3(2.6, 4.4, 2.2).normalize() },
    uFillColor: { value: new THREE.Color('#a9c9ff').multiplyScalar(0.5) },
    uFillDir: { value: new THREE.Vector3(-4, 1.5, 3).normalize() },
    uRimColor: { value: new THREE.Color('#ffffff').multiplyScalar(1.0) },
    uRimDir: { value: new THREE.Vector3(2.6 * 8, 2.2, 2.2 * 8).normalize() },
    ...(THREE.UniformsUtils.clone(THREE.UniformsLib.fog) as Record<string, THREE.IUniform>),
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: BLADE_VERT,
    fragmentShader: BLADE_FRAG,
    uniforms,
    side: THREE.DoubleSide,
    fog: true,
  });

  // ---- blade variants + instanced fields ---------------------------------
  const geos = [
    makeBlade(0.075, 0.017, 0.015),
    makeBlade(0.1, 0.018, 0.03),
    makeBlade(0.125, 0.016, 0.05),
    makeBlade(0.15, 0.02, 0.02),
  ];
  const per = Math.floor(blades / geos.length);
  const fields = geos.map((g) => new THREE.InstancedMesh(g, mat, per));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const relayout = (height: number, clumping: number) => {
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // clump pockets, biased toward the centre so foreground reads as tufts
    const centers: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < 620; i++) {
      const cr = radius * Math.pow(rand(), 1.7); // centre-weighted
      const ca = rand() * Math.PI * 2;
      centers.push({ x: Math.cos(ca) * cr, z: Math.sin(ca) * cr, r: 0.05 + rand() * 0.14 });
    }
    for (const field of fields) {
      for (let i = 0; i < field.count; i++) {
        let x: number;
        let z: number;
        if (rand() < clumping) {
          const c = centers[Math.floor(rand() * centers.length)];
          const cr = c.r * Math.sqrt(rand());
          const ca = rand() * Math.PI * 2;
          x = c.x + Math.cos(ca) * cr;
          z = c.z + Math.sin(ca) * cr;
        } else {
          // ART-DIRECTED DENSITY: pow(rand, 2) packs blades near the centre
          // (foreground) and lets them thin out toward the horizon
          const r = radius * Math.pow(rand(), 2.0);
          const a = rand() * Math.PI * 2;
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
        }
        const dist = Math.hypot(x, z) / radius;
        p.set(x, groundY(x, z) - 0.004, z);
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        // taller near the camera, a touch shorter far away
        const hmul = (0.7 + rand() * 0.7) * (1.15 - 0.45 * dist) * height;
        s.set(1, Math.max(0.25, hmul), 1);
        field.setMatrixAt(i, m.compose(p, q, s));
      }
      field.instanceMatrix.needsUpdate = true;
      field.frustumCulled = false;
    }
  };
  relayout(1, 0.55);
  for (const f of fields) group.add(f);

  // ---- foreground flowers (daisies + buttercups) -----------------------------
  const flowerTex = makeFlowerTexture();
  const flowerMat = new THREE.MeshBasicMaterial({
    map: flowerTex,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  const petal = new THREE.PlaneGeometry(0.09, 0.09);
  petal.translate(0, 0.045, 0);
  const petalX = petal.clone().rotateY(Math.PI / 2);
  const flowerGeo = mergeGeos([petal, petalX]); // a crossed card, visible from angles
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 90);
  {
    let seed = 91;
    const rand = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
    const col = new THREE.Color();
    for (let i = 0; i < flowers.count; i++) {
      const r = radius * 0.42 * Math.pow(rand(), 1.5); // near field only
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      p.set(x, groundY(x, z) + 0.02, z);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.setScalar(0.7 + rand() * 0.7);
      flowers.setMatrixAt(i, m.compose(p, q, s));
      // mostly white daisies, some yellow buttercups
      flowers.setColorAt(i, rand() < 0.35 ? col.set('#ffd23c') : col.set('#ffffff'));
    }
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    flowers.frustumCulled = false;
    group.add(flowers);
  }

  // ---- foreground rocks -------------------------------------------------------
  const rockGeo = new THREE.IcosahedronGeometry(0.12, 0);
  rockGeo.scale(1, 0.62, 1);
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshLambertMaterial({ color: '#8b8f96', flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 7);
  {
    let seed = 71;
    const rand = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
    for (let i = 0; i < rocks.count; i++) {
      const r = 1.5 + rand() * (radius * 0.4);
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      p.set(x, groundY(x, z) + 0.02, z);
      q.setFromEuler(new THREE.Euler(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6));
      s.setScalar(0.6 + rand() * 1.4);
      rocks.setMatrixAt(i, m.compose(p, q, s));
    }
    rocks.instanceMatrix.needsUpdate = true;
    group.add(rocks);
  }

  // ---- drifting cumulus clouds -------------------------------------------------
  const cloudEnv = makeClouds();
  group.add(cloudEnv.group);

  // every non-blade meadow material, for the studio crossfade
  const fadeMats: (THREE.MeshLambertMaterial | THREE.MeshBasicMaterial | THREE.MeshStandardMaterial)[] = [
    hillMat,
    flowerMat,
    rockMat,
    cloudEnv.material,
  ];
  let lastOpacity = 1;

  return {
    group,
    update: (t, charPos) => {
      uniforms.uTime.value = t;
      (uniforms.uPush.value as THREE.Vector3).copy(charPos);
      cloudEnv.drift(t);
    },
    setColors: (hill, base, tip, rock) => {
      hillMat.color.set(hill);
      (uniforms.uBase.value as THREE.Color).set(base);
      (uniforms.uTip.value as THREE.Color).set(tip);
      (uniforms.uShadow.value as THREE.Color).copy(uniforms.uBase.value as THREE.Color).multiplyScalar(0.55);
      if (rock) rockMat.color.set(rock);
    },
    setLights: (rig) => {
      (uniforms.uHemiSky.value as THREE.Color).set(rig.hemiSky).multiplyScalar(rig.hemiIntensity);
      (uniforms.uHemiGround.value as THREE.Color).set(rig.hemiGround).multiplyScalar(rig.hemiIntensity);
      (uniforms.uKeyColor.value as THREE.Color).set(rig.keyColor).multiplyScalar(rig.keyIntensity);
      (uniforms.uFillColor.value as THREE.Color).set(rig.fillColor).multiplyScalar(rig.fillIntensity);
      (uniforms.uRimColor.value as THREE.Color).set(rig.rimColor).multiplyScalar(rig.rimIntensity);
    },
    relayout,
    setOpacity: (o) => {
      if (o === lastOpacity) return;
      lastOpacity = o;
      const fading = o < 0.999;
      group.visible = o > 0.001;
      uniforms.uOpacity.value = o;
      mat.transparent = fading;
      mat.depthWrite = !fading; // while fading, don't occlude the studio sphere
      for (const fm of fadeMats) {
        fm.transparent = fading;
        fm.depthWrite = !fading;
        fm.opacity = o;
      }
      // the flower sprite is inherently transparent — keep its cutout behavior
      flowerMat.transparent = true;
    },
  };
}

// Comet-shaped low-poly cumulus clouds — same recipe/placement/material as web
// (MeshStandardMaterial: smooth per-fragment shading; Lambert's per-vertex
// Gouraud read as hard grey facets on the low-poly lobes).
const CLOUD_RECIPE: { x: number; y: number; s: [number, number, number] }[] = [
  // wide flat base lobes (flat underside)
  { x: -0.6, y: 0.12, s: [2.5, 0.85, 1.35] },
  { x: 0.7, y: 0.12, s: [2.4, 0.82, 1.3] },
  { x: 1.9, y: 0.15, s: [1.8, 0.72, 1.15] },
  // puffy dome — tallest in the middle
  { x: -1.2, y: 0.35, s: [1.6, 0.95, 1.2] },
  { x: -0.3, y: 0.6, s: [1.9, 1.25, 1.35] },
  { x: 0.6, y: 0.72, s: [2.1, 1.4, 1.4] },
  { x: 1.5, y: 0.58, s: [1.9, 1.2, 1.3] },
  { x: 2.4, y: 0.36, s: [1.5, 0.9, 1.15] },
  // short shoulder + a couple of trailing puffs
  { x: 3.2, y: 0.22, s: [1.15, 0.68, 0.95] },
  { x: 3.9, y: 0.12, s: [0.8, 0.5, 0.75] },
  { x: -2.1, y: 0.15, s: [1.0, 0.58, 0.85] },
];

function makeClouds(): {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  drift: (t: number) => void;
} {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 8, 6); // low-poly per the spec
  const mat = new THREE.MeshStandardMaterial({
    color: '#fdfdfb', // bright white
    roughness: 1,
    metalness: 0,
    emissive: new THREE.Color('#c4d2e2'), // cool lift so flat undersides read soft blue-grey
    // web adds a warm PMREM env on top (envIntensity 0.786); the emissive is
    // nudged up to stand in for that missing ambient
    emissiveIntensity: 0.24,
    fog: false, // background sky element — don't let the lawn fog eat it
  });
  const rand = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const comet = (dir: number, seed: number): THREE.Group => {
    const g = new THREE.Group();
    for (let k = 0; k < CLOUD_RECIPE.length; k++) {
      const pf = CLOUD_RECIPE[k];
      const [sx, sy, sz] = pf.s;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(sx * (0.9 + rand(seed + k) * 0.2), sy, sz);
      // flat underside: centre each puff near its own half-height
      mesh.position.set((pf.x - 2.3) * dir, sy * 0.85 + pf.y * 0.35, (rand(seed + k * 2) - 0.5) * 0.5);
      g.add(mesh);
    }
    return g;
  };
  const drifters: { g: THREE.Group; baseX: number; speed: number; wrap: number }[] = [];
  let idx = 0;
  const place = (
    n: number,
    scMin: number,
    scMax: number,
    yMin: number,
    yMax: number,
    zMin: number,
    zMax: number,
    xRange: number,
  ) => {
    for (let i = 0; i < n; i++) {
      const dir = rand(idx * 3 + 2) < 0.5 ? 1 : -1;
      const sc = scMin + rand(idx * 5 + 1) * (scMax - scMin);
      const x = (rand(idx * 7 + 3) - 0.5) * xRange;
      const y = yMin + rand(idx * 9 + 5) * (yMax - yMin);
      const z = zMin + rand(idx * 11 + 7) * (zMax - zMin);
      const c = comet(dir, idx * 13 + 1);
      c.position.set(x, y, z);
      c.scale.setScalar(sc);
      group.add(c);
      drifters.push({ g: c, baseX: x, speed: 0.04 + rand(idx * 2 + 9) * 0.08, wrap: xRange });
      idx++;
    }
  };
  place(4, 2.4, 3.2, 11, 16, -22, -40, 90); // huge near clouds
  place(9, 1.3, 2.1, 8, 13, -30, -55, 120); // medium mid-sky clouds
  place(15, 0.55, 1.1, 4, 9, -46, -84, 150); // small puffs banding the horizon
  const drift = (t: number) => {
    for (const d of drifters) {
      const span = d.wrap + 20;
      d.g.position.x = ((((d.baseX + t * d.speed + span / 2) % span) + span) % span) - span / 2;
    }
  };
  return { group, material: mat, drift };
}

// small procedural daisy: white petals around a yellow center, transparent bg.
// The web drew this on a DOM canvas; here it's rasterized directly. White petals
// (tinted per-instance via instanceColor) + a fixed yellow centre; the flower is
// 6-fold symmetric so orientation/flip doesn't matter.
function makeFlowerTexture(): THREE.DataTexture {
  const SIZE = 128;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const petalA = 13; // semi-minor (x)
  const petalB = 26; // semi-major (y)
  const petalCy = -34; // petal centre offset from the middle
  const centerR = 18;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = px - 64;
      const y = py - 64;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (x * x + y * y <= centerR * centerR) {
        // yellow centre
        r = 0xf7;
        g = 0xc3;
        b = 0x31;
        a = 255;
      } else {
        // six petal ellipses around the centre
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          // rotate the pixel into the petal's local frame
          const lx = ca * x + sa * y;
          const ly = -sa * x + ca * y;
          const dy = ly - petalCy;
          if ((lx * lx) / (petalA * petalA) + (dy * dy) / (petalB * petalB) <= 1) {
            r = g = b = 255;
            a = 255;
            break;
          }
        }
      }
      const o = (py * SIZE + px) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// merge a couple of simple geometries (no BufferGeometryUtils dependency)
function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const posArrays: number[] = [];
  const uvArrays: number[] = [];
  const indexArrays: number[] = [];
  let vertOffset = 0;
  for (const g of list) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      posArrays.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      uvArrays.push(uv.getX(i), uv.getY(i));
    }
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) indexArrays.push(idx.getX(i) + vertOffset);
    vertOffset += pos.count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(posArrays, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvArrays, 2));
  out.setIndex(indexArrays);
  out.computeVertexNormals();
  return out;
}
