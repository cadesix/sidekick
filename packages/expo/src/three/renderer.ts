import { Renderer } from 'expo-three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { deinterleaveGeometry, loadGLB, loadTexture } from './assets';
import { createCosmetics, type CosmeticsHandle } from './cosmetics';
import { configureFaceTexture, createFaceController, type FaceController } from './face';
import { patchWorldFog } from './fog-patch';
import { fillGradientTexture, makeGradientTexture, makeRadialShadowTexture } from './gradient';
import { BIOMES, type BiomeId, type EnvironmentId } from './biomes';
import { makeGrassEnvironment } from './grass';
import { makeStarFace, type StarFaceConfig } from './star-face';
import { createInteraction, POKE_FACE, type Interaction } from './interact';
import { loadSettings, type SidekickSettings } from './settings';
import {
  cloneWardrobe,
  loadWardrobe,
  saveWardrobe,
  WARDROBE_SLOTS,
  type CosmeticsControls,
} from './wardrobe';
import {
  makeCharacterMaterials,
  makeItemMaterial,
  makeOutlineMaterial,
  retintCelMaterial,
  retintOutlineMaterial,
  syncCelMapTransform,
  SUN_DIR,
  type TexSet,
} from './shading';
import type { BoxTier } from '@sidekick/core';

// Ported from sidekick/src/components/sidekick-canvas.tsx. The web version ran
// inside a React useEffect against a DOM <canvas>; here it runs against an
// expo-gl context. The scene-graph, bone posing, phone-pose blend and camera
// easing are the same logic; only the renderer/canvas plumbing, the (deferred)
// grass/interaction/cosmetics, and the DOM-canvas sky differ.

// require() the bundled, texture-stripped model (scripts/strip-glb.mjs).
const MASCOT_GLB = require('../../assets/models/sidekick-rigged.stripped.glb');
const LOOTBOX_GLB = require('../../assets/props/lootbox-v1.glb');
const FACE_SHEET = require('../../assets/textures/face-sheet-v6.png');

const BONE_MAP = {
  head: 'Head',
  waist: 'Waist',
  spine: 'Spine01',
  armL: 'L_Upperarm',
  armR: 'R_Upperarm',
  forearmL: 'L_Forearm',
  forearmR: 'R_Forearm',
  handL: 'L_Hand',
  handR: 'R_Hand',
  thighL: 'L_Thigh',
  thighR: 'R_Thigh',
  calfL: 'L_Calf',
  calfR: 'R_Calf',
} as const;
type BoneName = keyof typeof BONE_MAP;

// two-handed "holding phone" pose (authored in the /pose studio), verbatim
const PHONE_R = { swingX: -0.1, swingZ: 2.12, foreX: -0.47, foreZ: -0.53, twist: -1.06 };
const PHONE_L = { swingX: -1.41, swingZ: -1.56, foreX: -0.6, foreZ: -0.06, twist: 0.51 };
const PHONE_POSE = { headPitch: 0.19, headYaw: -0.13, bodyYaw: 0.55 };

export type Framing = {
  pos: [number, number, number];
  target: [number, number, number];
  fov?: number;
};

export type SidekickController = {
  setFraming: (f: Framing) => void;
  setHoldingPhone: (v: boolean) => void;
  setTalking: (v: boolean) => void;
  setStudio: (v: boolean) => void;
  // guided-session night sky: crossfade the meadow → dark starfield
  setCosmos: (v: boolean) => void;
  // TEMPORARY: live look-dev for the sky's star constellation (see
  // store/starFaceConfig.ts). Goes away once the numbers are baked in.
  setStarFace: (c: StarFaceConfig) => void;
  // swap the world environment (map travel): 'meadow' | biome id
  setEnvironment: (id: EnvironmentId) => void;
  // daily loot chest: spawn/hide (tier or null) + trigger the open animation
  setDailyBox: (tier: BoxTier | null) => void;
  popDailyBox: () => void;
  // live look-dev: re-apply a full settings object to the running scene
  applySettings: (next: SidekickSettings) => void;
  // touch input in NDC (-1..1, +y up) — fed by the canvas component
  pointerDown: (x: number, y: number) => void;
  pointerMove: (x: number, y: number) => void;
  pointerUp: (x: number, y: number) => void;
  dispose: () => void;
};

// Bump on every edit — logged at context creation so the debug loop can verify
// the bundle it launched is actually the code it just changed (Metro sometimes
// serves stale bundles; see scripts/sim-snap.sh).
export const BUILD_MARKER = 'build-053-star-face-module';

// Whether the production home renders through the bloom composer. Off: web
// /home5 renders direct (no post) with antialias, so we match it. Flip on only
// if a home-screen glow effect is deliberately wanted.
const HOME_BLOOM = false;

// Warm-sunset image-based-lighting scene, PMREM'd into scene.environment. This
// is the single biggest reason web's meadow reads lighter + warmer than a plain
// direct-lit render: every material (incl. the MeshLambert grass) picks up warm
// indirect fill from it. Ported DOM-free from sidekick-shading.ts's makeEnvScene
// (the web built its sky with a 2D <canvas>; here it's a DataTexture gradient).
function makeEnvScene(): THREE.Scene {
  const env = new THREE.Scene();
  const skyTex = makeGradientTexture(
    [
      { at: 0, color: '#ffe6c9' },
      { at: 0.5, color: '#f7c6b6' },
      { at: 1, color: '#e8b09e' },
    ],
    256,
  );
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 16, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }),
  );
  env.add(sky);
  const panel = (
    color: number,
    intensity: number,
    pos: [number, number, number],
    size: [number, number],
  ) => {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(size[0], size[1]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }),
    );
    p.position.set(pos[0], pos[1], pos[2]);
    p.lookAt(0, 0, 0);
    env.add(p);
  };
  panel(0xfff2dc, 3.5, [3, 4, 3], [4, 4]); // warm key
  panel(0xffc9d8, 1.5, [-4, 1, 2], [3, 4]); // pink fill
  panel(0xfff8f0, 2.5, [-1, 3, -4], [5, 2]); // rim
  return env;
}

export function createSidekickRenderer(
  gl: ExpoWebGLRenderingContext,
  opts: {
    framing: Framing;
    holdingPhone?: boolean;
    studio?: boolean;
    cosmos?: boolean;
    environment?: EnvironmentId;
    // daily loot chest tier (or null to hide); read live like the flags above
    dailyBox?: BoxTier | null;
    // per-frame ground-anchor screen position (NDC + visibility) for the daily
    // box tap-target overlay, mirroring the head overhead projection
    onGround?: (x: number, y: number, visible: boolean) => void;
    // handed the imperative dressing controls once cosmetics are ready (and
    // null on dispose) — the Shop sheet drives the live character through it
    onControls?: (c: CosmeticsControls | null) => void;
    // per-frame head-bone screen position in NDC (-1..1, +y up) + visibility
    // (z<1 = in front of camera). Drives head-tracked overlays (bond badge,
    // speech bubble); the canvas converts NDC→layout px. Web: overheadRef.
    onOverhead?: (x: number, y: number, visible: boolean) => void;
  },
): SidekickController {
  console.log(
    `[sidekick] ${BUILD_MARKER} context created ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
  );
  // world-anchored fog chunks must be in place before any material compiles
  patchWorldFog();
  let s: SidekickSettings = loadSettings();
  const sc = s.scenes[s.timeOfDay];

  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;

  const scene = new THREE.Scene();

  // Sky: the web sets the gradient as scene.background — a SCREEN-SPACE quad,
  // so the full top→horizon ramp spans the viewport regardless of camera fov.
  // (An earlier build mapped it onto a skydome; the narrow fov then saw only a
  // thin slice of the ramp and the sky read as a flat saturated blue.)
  const skyStops = (p: { skyHorizon: string; skyMid: string; skyTop: string }) => [
    { at: 0, color: p.skyHorizon },
    { at: 0.42, color: p.skyMid },
    { at: 1, color: p.skyTop },
  ];
  const skyTex = makeGradientTexture(skyStops(sc));
  scene.background = skyTex;
  scene.fog = new THREE.Fog(sc.fog, sc.fogNear, sc.fogFar);

  // Painterly lawn: domed hill, 20k wind-swept instanced blades (they bend away
  // from his feet), daisies, rocks, drifting clouds — same module as the web.
  const grass = makeGrassEnvironment();
  grass.setColors(sc.grassHill, sc.grassBase, sc.grassTip, sc.rock);
  grass.setClouds(sc.keyColor, sc.fog);
  grass.relayout(s.grassHeight, s.grassClumping);
  scene.add(grass.group);

  // Shop "studio" look, crossfaded in by `studio`: an inward backdrop sphere
  // (soft warm vertical sweep, light top → warm floor) + a contact shadow fade
  // IN while the meadow fades OUT. Built once; the loop eases the blend.
  // (Web drew the sweep with a DOM canvas; stops here are bottom→top.)
  const meadowFog = scene.fog as THREE.Fog;
  const studioTex = makeGradientTexture([
    { at: 0, color: '#d6ccbb' },
    { at: 0.45, color: '#ece2d3' },
    { at: 1, color: '#f6f1e9' },
  ]);
  const studioSphere = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 20),
    new THREE.MeshBasicMaterial({
      map: studioTex,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    }),
  );
  studioSphere.renderOrder = -2; // draw behind the character
  studioSphere.visible = false;
  scene.add(studioSphere);
  const contactShadowTex = makeRadialShadowTexture();
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.95),
    new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.006;
  contactShadow.renderOrder = -1;
  contactShadow.visible = false;
  scene.add(contactShadow);

  // ---- Guided-session "cosmos": a dark-purple night sky with a twinkling
  // starfield and a constellation that draws itself as the chat progresses.
  // Crossfaded in by `cosmos` (like `studio`); the camera pans up to the sky
  // (COSMOS_FRAMING) so the character sits out of frame below. Everything hangs
  // off `cosmosGroup` so it fades together with `cosmosT`.
  const cosmosGroup = new THREE.Group();
  cosmosGroup.visible = false;
  scene.add(cosmosGroup);

  // dark-purple vertical gradient backdrop (bottom faintly lit → top near-black)
  const nightTex = makeGradientTexture([
    { at: 0, color: '#241640' },
    { at: 0.5, color: '#140b2b' },
    { at: 1, color: '#080418' },
  ]);
  const nightSphere = new THREE.Mesh(
    new THREE.SphereGeometry(80, 32, 20),
    new THREE.MeshBasicMaterial({ map: nightTex, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }),
  );
  nightSphere.renderOrder = -3; // behind everything
  cosmosGroup.add(nightSphere);
  const nightMat = nightSphere.material as THREE.MeshBasicMaterial;

  // twinkling starfield — tiny additive points over the upper sky dome
  const STAR_COUNT = 320;
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starPhase = new Float32Array(STAR_COUNT);
  const starSize = new Float32Array(STAR_COUNT);
  {
    let placed = 0;
    const v = new THREE.Vector3();
    while (placed < STAR_COUNT) {
      v.set(Math.random() * 2 - 1, Math.random() * 1.3 - 0.15, Math.random() * 2 - 1);
      if (v.y < 0.12) continue; // keep the upper dome
      v.normalize().multiplyScalar(66);
      starPos[placed * 3] = v.x;
      starPos[placed * 3 + 1] = v.y + 6;
      starPos[placed * 3 + 2] = v.z;
      starPhase[placed] = Math.random() * Math.PI * 2;
      starSize[placed] = 0.6 + Math.random() * 1.8;
      placed++;
    }
  }
  const starUniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#cdbfff') } };
  const starMat = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'attribute float aPhase; attribute float aSize; uniform float uTime; varying float vTw;\n' +
      'void main(){ vTw = 0.5 + 0.5*sin(uTime*1.6 + aPhase); vec4 mv = modelViewMatrix * vec4(position,1.0);\n' +
      '  gl_PointSize = aSize * (1.0 + vTw*0.8) * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader:
      'uniform float uOpacity; uniform vec3 uColor; varying float vTw;\n' +
      'void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r);\n' +
      '  gl_FragColor = vec4(uColor, a * uOpacity * (0.35 + vTw*0.65)); }',
  });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhase, 1));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.renderOrder = -2;
  cosmosGroup.add(starPoints);

  // the sidekick, drawn in stars, hanging in the night sky (three/star-face.ts)
  const starFace = makeStarFace();
  cosmosGroup.add(starFace.group);

  // Camera
  let framing = opts.framing;
  const camera = new THREE.PerspectiveCamera(framing.fov ?? s.fov, width / height, 0.1, 260);
  const camBasePos = new THREE.Vector3().fromArray(framing.pos);
  const camBaseTarget = new THREE.Vector3().fromArray(framing.target);
  camera.position.copy(camBasePos);
  camera.lookAt(camBaseTarget);

  // Renderer (expo-three wraps THREE.WebGLRenderer around the expo-gl context)
  const renderer = new Renderer({ gl }) as unknown as THREE.WebGLRenderer;
  renderer.setSize(width, height);
  // NOTE: do NOT call renderer.setViewport/setScissorTest here — overriding
  // expo-three's own viewport state blanks the whole scene on expo-gl.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = sc.exposure;

  // Warm IBL — matches web's scene.environment. PMREM prefilters the env scene
  // into an environment map; MeshLambert/cel materials pick up its warm indirect
  // fill, which is what makes the meadow read lighter + warmer than direct light
  // alone. (PMREM uses a half-float render target — fine on WebGL2/Expo Web; if
  // a native expo-gl build can't allocate it, guard this behind a try/catch.)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = makeEnvScene();
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  (scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = s.envIntensity;
  pmrem.dispose();

  // shadows: shadowOpacity defaults to 0 (no visible shadow), so we skip the
  // shadow map on mobile for perf. Re-enable when a lawn shadow is wanted.

  // Light rig from the active time-of-day preset
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(sc.hemiSky),
    new THREE.Color(sc.hemiGround),
    sc.hemiIntensity,
  );
  scene.add(hemi);
  const key = new THREE.DirectionalLight(new THREE.Color(sc.keyColor), sc.keyIntensity);
  key.position.copy(SUN_DIR).multiplyScalar(12);
  scene.add(key);
  const fill = new THREE.DirectionalLight(new THREE.Color(sc.fillColor), sc.fillIntensity);
  fill.position.set(-4, 1.5, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(new THREE.Color(sc.rimColor), sc.rimIntensity);
  rim.position.copy(SUN_DIR).multiplyScalar(8).setY(2.2);
  scene.add(rim);

  // ---- biome environments (map travel) --------------------------------------
  // Lazily built + cached like web's applyEnv (sidekick-canvas.tsx). Swapping the
  // environment changes background/fog/lights/exposure/cloud tint + the raking
  // key/rim directions, and toggles which ground group is visible. Composes with
  // the studio crossfade below via `activeGround` + `envFog`.
  const meadowSky = skyTex;
  const meadowKeyPos = key.position.clone();
  const meadowRimPos = rim.position.clone();
  const tmpDir = new THREE.Vector3();
  let envFog: THREE.Fog | null = meadowFog;
  let activeGround: THREE.Object3D = grass.group;
  type BiomeBuilt = { group: THREE.Group; sky: THREE.DataTexture; fog: THREE.Fog };
  const biomeCache = new Map<BiomeId, BiomeBuilt>();
  const getBiome = (id: BiomeId): BiomeBuilt => {
    let bc = biomeCache.get(id);
    if (!bc) {
      const def = BIOMES[id];
      const group = def.build();
      group.visible = false;
      scene.add(group);
      const p = def.preset;
      const sky = makeGradientTexture(skyStops(p));
      const fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
      bc = { group, sky, fog };
      biomeCache.set(id, bc);
    }
    return bc;
  };
  const applyEnv = (id: EnvironmentId) => {
    activeGround.visible = false;
    let look: typeof sc | (typeof BIOMES)[BiomeId]['preset'];
    if (id === 'meadow') {
      look = s.scenes[s.timeOfDay];
      scene.background = meadowSky;
      envFog = scene.fog as THREE.Fog; // meadow fog is refilled by applySettings
      activeGround = grass.group;
      key.position.copy(meadowKeyPos);
      rim.position.copy(meadowRimPos);
    } else {
      const bc = getBiome(id);
      look = BIOMES[id].preset;
      scene.background = bc.sky;
      envFog = bc.fog;
      activeGround = bc.group;
      key.position.copy(tmpDir.fromArray(BIOMES[id].preset.keyDir).normalize()).multiplyScalar(16);
      rim.position.copy(tmpDir.fromArray(BIOMES[id].preset.rimDir).normalize()).multiplyScalar(12);
    }
    key.color.set(look.keyColor);
    key.intensity = look.keyIntensity;
    fill.color.set(look.fillColor);
    fill.intensity = look.fillIntensity;
    rim.color.set(look.rimColor);
    rim.intensity = look.rimIntensity;
    hemi.color.set(look.hemiSky);
    hemi.groundColor.set(look.hemiGround);
    hemi.intensity = look.hemiIntensity;
    renderer.toneMappingExposure = look.exposure;
    grass.setClouds(look.keyColor, look.fog);
    activeGround.visible = true; // the studio crossfade may re-hide it next frame
  };
  let environment: EnvironmentId = opts.environment ?? 'meadow';
  let curEnv: EnvironmentId = 'meadow';
  if (environment !== 'meadow') applyEnv(environment), (curEnv = environment);

  // ---- bloom (matches the web viewer's UnrealBloomPass). expo-gl reports no
  // EXT_color_buffer_float, so every render target in the chain is forced to
  // 8-bit — slight banding in the glow, but renderable. OutputPass applies the
  // ACES/sRGB output transform the direct path gets from rendering to screen.
  //
  // samples:4 → MSAA on the composer's render target. Without it the scene is
  // rendered to a non-multisampled FBO (the context's own antialias:true only
  // covers the DEFAULT framebuffer, which the composer bypasses), so thin grass
  // blades aliased into hard dark-gapped spikes and read far darker/sparser than
  // web's direct antialiased render. WebGL2 caps at MAX_SAMPLES (4 here).
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    s.bloomStrength,
    s.bloomRadius,
    s.bloomThreshold,
  );
  const forceByte = (rt: THREE.WebGLRenderTarget) => {
    rt.texture.type = THREE.UnsignedByteType;
  };
  forceByte(bloomPass.renderTargetBright);
  bloomPass.renderTargetsHorizontal.forEach(forceByte);
  bloomPass.renderTargetsVertical.forEach(forceByte);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  // if the composer chain dies on expo-gl, fall back to direct rendering
  let bloomBroken = false;

  // pull group carries body-drag (interaction deferred → stays at rest); rig
  // holds the model-facing yaw.
  const pull = new THREE.Group();
  scene.add(pull);
  const rig = new THREE.Group();
  rig.rotation.y = -Math.PI / 2; // model faces +X raw
  pull.add(rig);

  const bones = {} as Record<BoneName, THREE.Bone>;
  const rest = {} as Record<BoneName, THREE.Quaternion>;
  let ready = false;
  let faceCtl: FaceController | null = null;
  // the face controller animates the sheet's offset/repeat (blink/talk); the
  // cel ShaderMaterial needs its uv-transform uniform re-synced every frame
  let faceMat: THREE.Material | null = null;
  let faceSheet: THREE.Texture | null = null;
  let holdingPhone = !!opts.holdingPhone;
  let talking = false;
  let studio = !!opts.studio;
  let cosmos = !!opts.cosmos;
  let disposed = false;
  let cos: CosmeticsHandle | null = null;
  // rebuilds the character materials from the CURRENT `s`; set once the GLB is
  // in. retintShading updates the SAME materials' uniforms in place — the live
  // tuning path (a rebuild swaps GL programs mid-frame and reads as flashing).
  let applyShading: (() => void) | null = null;
  let retintShading: (() => void) | null = null;
  let outlineMesh: THREE.SkinnedMesh | null = null;

  // ---- async load: model + face sheet ----
  (async () => {
    let bodyMesh: THREE.SkinnedMesh | null = null;
    let faceMesh: THREE.SkinnedMesh | null = null;
    let faceTex: THREE.Texture | null = null;

    try {
      faceTex = configureFaceTexture(await loadTexture(FACE_SHEET));
    } catch (e) {
      console.warn('[sidekick] face sheet load failed', e);
    }

    const gltf = await loadGLB(MASCOT_GLB);
    if (disposed) return;
    const model = gltf.scene;
    const texSet: TexSet = { map: null, normalMap: null, vertexColors: false };

    model.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        deinterleaveGeometry(geo);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        // discriminate the two primitives by material name (textures stripped,
        // so the web app's "has map?" test no longer works)
        const matName = (child.material as THREE.Material).name;
        if (matName === 'FaceSprite') faceMesh = child;
        else bodyMesh = child;
        child.frustumCulled = false;
        child.normalizeSkinWeights();
      }
    });

    applyShading = () => {
      const { body, face } = makeCharacterMaterials(s, texSet, faceTex);
      if (bodyMesh) {
        ((bodyMesh as THREE.SkinnedMesh).material as THREE.Material).dispose?.();
        (bodyMesh as THREE.SkinnedMesh).material = body;
      }
      if (faceMesh) {
        ((faceMesh as THREE.SkinnedMesh).material as THREE.Material).dispose?.();
        (faceMesh as THREE.SkinnedMesh).material = face;
      }
      if (faceTex) {
        faceMat = face;
        faceSheet = faceTex;
      }
      if (outlineMesh) {
        (outlineMesh.material as THREE.Material).dispose();
        outlineMesh.material = makeOutlineMaterial(s);
        outlineMesh.visible = s.outline;
      }
    };
    retintShading = () => {
      if (bodyMesh) retintCelMaterial((bodyMesh as THREE.SkinnedMesh).material as THREE.Material, s, s.celBodyColor);
      if (faceMesh) retintCelMaterial((faceMesh as THREE.SkinnedMesh).material as THREE.Material, s);
      if (outlineMesh) {
        retintOutlineMaterial(outlineMesh.material as THREE.Material, s);
        outlineMesh.visible = s.outline;
      }
    };
    if (faceTex) faceCtl = createFaceController(faceTex, s.faceZoom, s.faceHeight);

    // inverted-hull outline on the body (always built; visibility follows the
    // live outline setting)
    if (bodyMesh) {
      const b = bodyMesh as THREE.SkinnedMesh;
      outlineMesh = new THREE.SkinnedMesh(b.geometry, makeOutlineMaterial(s));
      outlineMesh.bind(b.skeleton, b.bindMatrix);
      outlineMesh.position.copy(b.position);
      outlineMesh.quaternion.copy(b.quaternion);
      outlineMesh.scale.copy(b.scale);
      outlineMesh.frustumCulled = false;
      outlineMesh.visible = s.outline;
      b.parent!.add(outlineMesh);
    }
    applyShading();

    // normalize: 1 unit tall, centered on x/z, feet at y=0.
    // Compute bounds from the body geometry's raw (bind-pose) positions — NOT
    // Box3.setFromObject, which on a SkinnedMesh walks every vertex through
    // skeleton.bones[skinIndex].matrixWorld and throws if any skinIndex is
    // out of range (this GLB has a few).
    const box = new THREE.Box3();
    if (bodyMesh) {
      const posAttr = (bodyMesh as THREE.SkinnedMesh).geometry.getAttribute('position');
      box.setFromBufferAttribute(posAttr as THREE.BufferAttribute);
    }
    const k = 1 / (box.max.y - box.min.y || 1);
    model.scale.setScalar(k);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    rig.add(model);

    for (const [ours, theirs] of Object.entries(BONE_MAP)) {
      const bone = model.getObjectByName(theirs);
      if (bone instanceof THREE.Bone) {
        bones[ours as BoneName] = bone;
        rest[ours as BoneName] = bone.quaternion.clone();
      }
    }
    ready = Object.keys(bones).length === Object.keys(BONE_MAP).length;
    if (!ready) console.warn('[sidekick] missing bones', Object.keys(bones));
    console.log('[sidekick] model ready');

    // modular equipment: manifest-driven cosmetics bound to this rig, dressed
    // from the saved wardrobe (the Shop drives it live)
    if (bodyMesh) {
      cos = createCosmetics(bodyMesh, s);
      const wardrobe = await loadWardrobe();
      if (disposed) return;
      for (const slot of WARDROBE_SLOTS) {
        const st = wardrobe[slot];
        if (!st.equipped) continue;
        void cos.equip(slot, st.variantId).then(() => {
          if (st.color) cos?.setColor(slot, st.color);
        });
      }
      // preload the phone into the hand, hidden until holdingPhone blends in
      void cos.equip('phone').then(() => cos?.setVisible('phone', phoneShown));

      // hand imperative dressing controls to React (Shop UI)
      opts.onControls?.({
        manifest: () => cos!.slots(),
        getState: () => cloneWardrobe(wardrobe),
        equipVariant: (slot, variantId) => {
          wardrobe[slot] = { equipped: true, variantId, color: undefined };
          saveWardrobe(wardrobe);
          void cos?.equip(slot, variantId);
        },
        setColor: (slot, color) => {
          const wasOff = !wardrobe[slot].equipped;
          const variantId = wardrobe[slot].variantId ?? cos!.slots()[slot]?.variants[0]?.id;
          wardrobe[slot] = { equipped: true, variantId, color };
          saveWardrobe(wardrobe);
          if (wasOff) void cos?.equip(slot, variantId).then(() => cos?.setColor(slot, color));
          else cos?.setColor(slot, color);
        },
        remove: (slot) => {
          wardrobe[slot] = { ...wardrobe[slot], equipped: false };
          saveWardrobe(wardrobe);
          cos?.unequip(slot);
        },
      });
    }
  })().catch((e) => console.error('[sidekick] load failed', e));

  // ---- bone helpers (ported verbatim) ----
  const e = new THREE.Euler();
  const qWorld = new THREE.Quaternion();
  const qParent = new THREE.Quaternion();
  const qLocal = new THREE.Quaternion();
  const setBoneQ = (name: BoneName, q: THREE.Quaternion) => {
    const bone = bones[name];
    bone.parent!.getWorldQuaternion(qParent);
    qLocal.copy(qParent).invert().multiply(q).multiply(qParent);
    bone.quaternion.copy(qLocal).multiply(rest[name]);
  };
  const setBone = (name: BoneName, ex: number, ey: number, ez: number) => {
    qWorld.setFromEuler(e.set(ex, ey, ez));
    setBoneQ(name, qWorld);
  };
  const qSwing = new THREE.Quaternion();
  const qRoll = new THREE.Quaternion();
  const qArm = new THREE.Quaternion();
  const armAxis = new THREE.Vector3();
  const setArm = (
    arm: BoneName,
    forearm: BoneName,
    side: 1 | -1,
    swingX: number,
    swingZ: number,
    roll: number,
    foreX: number,
    foreZ = 0,
  ) => {
    qSwing.setFromEuler(e.set(swingX, 0, swingZ));
    armAxis.set(side, 0, 0).applyQuaternion(qSwing);
    qRoll.setFromAxisAngle(armAxis, roll * s.poseRollSplit);
    qArm.copy(qRoll).multiply(qSwing);
    setBoneQ(arm, qArm);
    qSwing.setFromEuler(e.set(foreX, 0, foreZ));
    qRoll.setFromAxisAngle(armAxis, roll * (1 - s.poseRollSplit));
    qArm.copy(qRoll).multiply(qSwing);
    setBoneQ(forearm, qArm);
  };

  // ---- poke/drag interaction (springs + plane-projected classification;
  // touch fed by the canvas — no mesh raycasting, see interact.ts header)
  const interact: Interaction = createInteraction({
    camera,
    bone: (n) => bones[n],
    cameraDrag: true,
    onPoke: (part) => {
      const expr = POKE_FACE[part];
      if (expr) faceCtl?.pulse(expr, 1.6);
    },
  });

  // ---- animation loop ----
  const clock = new THREE.Clock();
  const wantPos = new THREE.Vector3();
  const wantTgt = new THREE.Vector3();
  const camOff = new THREE.Vector3();
  const camSph = new THREE.Spherical();
  const overheadV = new THREE.Vector3(); // scratch for head→screen projection
  const lerp = THREE.MathUtils.lerp;
  let phoneBlend = 0;
  let phoneShown = false;
  let studioT = 0; // eased meadow→studio blend (0 meadow, 1 studio)
  let cosmosT = 0; // eased meadow→night-sky blend (guided session)
  let raf = 0;
  let snapFrame = 0;
  const studioMat = studioSphere.material as THREE.MeshBasicMaterial;
  const shadowMat = contactShadow.material as THREE.MeshBasicMaterial;

  // ---- daily loot chest (world prop; the RN GroundBox owns the tap target) ----
  // Ported from web sidekick-canvas.tsx: a GLB chest at the ground anchor,
  // tinted per tier, that idle-rattles then (on popDailyBox) swings its lid and
  // pours an additive light beam + a real point light.
  const DAILY_BOX_POS = new THREE.Vector3(0.1, 0, 0.75);
  const DAILY_BOX_SCALE = 0.34;
  const BOX_PALETTES: Record<BoxTier, Record<string, string>> = {
    base: { Chest_Body: '#FFD65C', Chest_Trim: '#FF5B4D', Chest_Emblem: '#FFF2DC' },
    silver: { Chest_Body: '#DCE6F5', Chest_Trim: '#7C5CFF', Chest_Emblem: '#FFFFFF' },
    gold: { Chest_Body: '#FFC93D', Chest_Trim: '#7C5CFF', Chest_Emblem: '#FFF6D8' },
  };
  const boxGroup = new THREE.Group();
  boxGroup.position.copy(DAILY_BOX_POS);
  boxGroup.rotation.y = -0.3;
  boxGroup.visible = false;
  scene.add(boxGroup);
  const groundV = new THREE.Vector3(); // scratch for chest→screen projection
  let boxMeshes: THREE.Mesh[] = [];
  let boxLidNodes: THREE.Object3D[] = [];
  let boxTint: BoxTier | null = null;
  let boxLoading = false;
  let boxSpawn = -1;
  let boxPop = -1;
  let beamOpacity: { value: number } | null = null;
  let beam: THREE.Mesh | null = null;
  let boxLight: THREE.PointLight | null = null;
  let dailyBox: BoxTier | null = opts.dailyBox ?? null;
  const tintBox = (tier: BoxTier) => {
    const pal = BOX_PALETTES[tier];
    for (const m of boxMeshes) {
      (m.material as THREE.Material).dispose?.();
      m.material = makeItemMaterial(s, {
        color: pal[m.userData.matName as string] ?? pal.Chest_Body,
        map: null,
      });
    }
    boxTint = tier;
  };
  const loadBox = () => {
    boxLoading = true;
    loadGLB(LOOTBOX_GLB)
      .then((g) => {
        if (disposed) return;
        const meshes: THREE.Mesh[] = [];
        g.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
            deinterleaveGeometry(mesh.geometry);
            meshes.push(mesh);
          }
        });
        for (const mesh of meshes) {
          mesh.userData.matName = (mesh.material as THREE.Material).name;
          const ink = new THREE.Mesh(
            mesh.geometry,
            makeOutlineMaterial({ ...s, outlineWidth: (s.outlineWidth * 5) / DAILY_BOX_SCALE }),
          );
          mesh.add(ink);
        }
        boxMeshes = meshes;
        boxLidNodes = meshes.filter((m) => m.name.startsWith('LootLid'));
        // additive beam cone rising from the mouth (fresnel edge + vertical fade)
        const beamUniforms = { uColor: { value: new THREE.Color(0xfff2b8) }, uOpacity: { value: 0 } };
        beamOpacity = beamUniforms.uOpacity;
        const beamMat = new THREE.ShaderMaterial({
          uniforms: beamUniforms,
          vertexShader:
            'varying vec3 vN; varying vec3 vV; varying float vY;\n' +
            'void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }',
          fragmentShader:
            'uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying float vY;\n' +
            'void main() { float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float fade = smoothstep(0.85, -0.55, vY); gl_FragColor = vec4(uColor, uOpacity * edge * fade); }',
          transparent: true,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.3, 1.7, 24, 1, true), beamMat);
        beam.position.y = 0.5 + 0.85;
        boxGroup.add(beam);
        boxLight = new THREE.PointLight(0xffe9b0, 0, 5, 1.6);
        boxLight.position.y = 0.7;
        boxGroup.add(boxLight);
        boxGroup.add(g.scene);
        boxSpawn = clock.getElapsedTime();
        if (dailyBox) tintBox(dailyBox);
      })
      .catch((e) => console.warn('[sidekick] lootbox load failed', e));
  };

  const animate = () => {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const now = clock.getElapsedTime();
    const fr = interact.update(now);

    // swap the world environment when travel changes it (masked by the map cover)
    if (environment !== curEnv) {
      curEnv = environment;
      applyEnv(curEnv);
    }
    // crossfade the meadow out / studio in when the Shop opens (and back)
    const targetT = studio ? 1 : 0;
    studioT += (targetT - studioT) * 0.3;
    if (Math.abs(targetT - studioT) < 0.003) studioT = targetT;
    const inStudio = studioT > 0.001;
    studioSphere.visible = inStudio;
    studioMat.opacity = studioT;
    contactShadow.visible = inStudio;
    shadowMat.opacity = studioT;

    // guided-session night sky crossfade — mirrors the studio blend, but slower
    // so it eases in under the camera's pan up to the sky
    cosmosT += ((cosmos ? 1 : 0) - cosmosT) * 0.06;
    if (Math.abs((cosmos ? 1 : 0) - cosmosT) < 0.002) cosmosT = cosmos ? 1 : 0;
    const inCosmos = cosmosT > 0.001;
    // studio backdrop or the night sky — either one fully hides the meadow
    const inCover = inStudio || inCosmos;
    cosmosGroup.visible = inCosmos;
    nightMat.opacity = cosmosT;
    starUniforms.uOpacity.value = cosmosT;
    starUniforms.uTime.value = now;
    starFace.update(now, cosmosT);
    // the character sits out of frame under the up-pan; drop it entirely once in
    pull.visible = cosmosT < 0.9;

    // meadow grass crossfades by opacity; skip its ~20k-blade draw entirely once
    // either the studio OR the night sky fully covers it (biome ground toggles)
    const coverT = Math.max(studioT, cosmosT);
    if (activeGround === grass.group) {
      const grassVisible = coverT < 0.999;
      grass.group.visible = grassVisible;
      if (grassVisible) grass.setOpacity(1 - coverT);
    } else activeGround.visible = !inCover;
    scene.fog = inCover ? null : envFog;

    // body-drag lean/offset/squash (springs home to rest on release)
    pull.position.set(fr.bodyX, 0, fr.bodyZ);
    pull.rotation.set(fr.tiltX, 0, fr.tiltZ);
    pull.scale.set(1 / Math.sqrt(fr.squash), fr.squash, 1 / Math.sqrt(fr.squash));

    if (ready) {
      const breath = 1 + Math.sin(now * 2.2) * 0.012;
      rig.scale.set(1 / Math.sqrt(breath), breath, 1 / Math.sqrt(breath));
      const sway = Math.sin(now * 2.2) * 0.04;
      phoneBlend += ((holdingPhone ? 1 : 0) - phoneBlend) * 0.09;
      // toggle the phone prop with the pose blend (visible while any of the
      // hold pose is blended in)
      const wantShown = phoneBlend > 0.02;
      if (wantShown !== phoneShown) {
        phoneShown = wantShown;
        cos?.setVisible('phone', wantShown);
      }
      const pb = phoneBlend;
      // swing the whole body off-square BEFORE posing the arms — setBoneQ maps
      // each arm's world-space delta through the parent's current world
      // quaternion, so the body yaw must already be in place
      pull.rotation.y = PHONE_POSE.bodyYaw * pb;
      // both arms blend from idle (+ drag pulls) toward the phone-hold pose
      setArm(
        'armL',
        'forearmL',
        1,
        lerp(s.poseArmForward + fr.armL.fwd, PHONE_L.swingX, pb),
        lerp(-s.poseArmDown + sway + fr.armL.swing, PHONE_L.swingZ, pb),
        lerp(s.poseArmTwist, PHONE_L.twist, pb),
        lerp(s.poseForeBend, PHONE_L.foreX, pb),
        lerp(0, PHONE_L.foreZ, pb),
      );
      setArm(
        'armR',
        'forearmR',
        -1,
        lerp(s.poseArmForward + fr.armR.fwd, PHONE_R.swingX, pb),
        lerp(s.poseArmDown - sway + fr.armR.swing, PHONE_R.swingZ, pb),
        lerp(-s.poseArmTwist, PHONE_R.twist, pb),
        lerp(s.poseForeBend, PHONE_R.foreX, pb),
        lerp(0, PHONE_R.foreZ, pb),
      );
      bones.armL.scale.setScalar(1 + fr.armL.stretch);
      bones.armR.scale.setScalar(1 + fr.armR.stretch);
      // tilt the head up to gaze at the sky as the night crossfades in (peaks
      // just before the character slides out of frame under the camera pan)
      const cosmosLook = Math.min(1, cosmosT / 0.8) * 0.6;
      setBone('head', fr.headPitch + PHONE_POSE.headPitch * pb - cosmosLook, fr.headYaw + PHONE_POSE.headYaw * pb, 0);
      // body-drag bend splits across waist + spine (arc toward the grab
      // point); the trailing leg lifts and its knee curls when off balance
      setBone('waist', fr.bendX * 0.5, 0, fr.bendZ * 0.5);
      setBone('spine', fr.bendX * 0.5, 0, fr.bendZ * 0.5);
      setBone('thighL', 0, 0, fr.legL.lift);
      setBone('calfL', fr.legL.curl, 0, 0);
      setBone('thighR', 0, 0, fr.legR.lift);
      setBone('calfR', fr.legR.curl, 0, 0);
    }

    // ease camera toward the current framing (smooth zoom on chat open). The
    // guided-session pan up to the sky uses a slower rate so the tilt reads as a
    // deliberate, felt move rather than a snap.
    const camK = cosmos ? 0.032 : 0.07;
    camBasePos.lerp(wantPos.fromArray(framing.pos), camK);
    camBaseTarget.lerp(wantTgt.fromArray(framing.target), camK);
    const wantFov = framing.fov ?? camera.fov;
    if (Math.abs(wantFov - camera.fov) > 0.02) {
      camera.fov += (wantFov - camera.fov) * camK;
      camera.updateProjectionMatrix();
    }
    // springy orbit offset around the framing; snaps back on release
    camOff.copy(camBasePos).sub(camBaseTarget);
    camSph.setFromVector3(camOff);
    camSph.theta += fr.camYaw;
    camSph.phi = THREE.MathUtils.clamp(camSph.phi + fr.camPitch, 0.3, Math.PI - 0.3);
    camera.position.setFromSpherical(camSph).add(camBaseTarget);
    camera.lookAt(camBaseTarget);

    grass.update(now, pull.position);

    // ---- daily loot chest: spawn spring → idle rattle → (pop) lid + light ----
    const wantBox = dailyBox;
    if (wantBox && !boxMeshes.length && !boxLoading) loadBox();
    if (wantBox && boxMeshes.length && boxTint !== wantBox) tintBox(wantBox);
    if (!wantBox && boxPop >= 0) {
      boxPop = -1;
      for (const n of boxLidNodes) n.rotation.x = 0;
      if (beamOpacity) beamOpacity.value = 0;
      if (boxLight) boxLight.intensity = 0;
    }
    const popT = boxPop >= 0 ? now - boxPop : -1;
    boxGroup.visible = !!wantBox && !inStudio && boxMeshes.length > 0;
    if (boxGroup.visible) {
      const ts = Math.min(1, (now - boxSpawn) / 0.55);
      const spring = 1 - Math.pow(1 - ts, 3) * Math.cos(ts * 9); // overshoot
      boxGroup.scale.setScalar(Math.max(0.0001, DAILY_BOX_SCALE * spring));
      if (popT < 0) {
        const cycle = (now - boxSpawn) % 1.7; // rattle burst every ~1.7s
        let rattle = 0;
        if (cycle < 0.55) {
          const env = Math.sin((cycle / 0.55) * Math.PI);
          rattle = Math.sin(cycle * 50) * 0.09 * env;
        }
        boxGroup.rotation.z = rattle;
        boxGroup.position.y = DAILY_BOX_POS.y + Math.abs(rattle) * 0.14;
      } else {
        boxGroup.rotation.z = popT < 0.35 ? Math.sin(popT * 46) * 0.13 * (0.5 + popT * 2) : 0;
        boxGroup.position.y = DAILY_BOX_POS.y;
        const lt = Math.min(1, Math.max(0, (popT - 0.35) / 0.4));
        const k = 1.9; // ease-out-back
        const swing = 1 + (k + 1) * Math.pow(lt - 1, 3) + k * Math.pow(lt - 1, 2);
        for (const n of boxLidNodes) n.rotation.x = -1.75 * swing;
        const lightT = Math.min(1, Math.max(0, (popT - 0.62) / 0.18));
        if (beamOpacity && beam) {
          beamOpacity.value = lightT * (0.85 + 0.08 * Math.sin(now * 6.5));
          beam.scale.set(1, 0.35 + 0.65 * lightT, 1);
        }
        if (boxLight) boxLight.intensity = lightT * 6 * (0.9 + 0.1 * Math.sin(now * 5.7));
      }
      // ground-anchor projection for the RN tap-target overlay
      if (opts.onGround) {
        groundV.copy(DAILY_BOX_POS);
        groundV.project(camera);
        opts.onGround(groundV.x, groundV.y, groundV.z < 1);
      }
    } else if (opts.onGround) {
      opts.onGround(0, 0, false);
    }

    if (faceCtl) {
      faceCtl.setTalking(talking);
      faceCtl.update(now);
      if (faceMat && faceSheet) syncCelMapTransform(faceMat, faceSheet);
    }
    // Direct render, matching web /home5 (sidekick-canvas.tsx), which renders
    // straight to the antialiased default framebuffer with NO post-processing.
    // The bloom composer is kept wired (for the /sidekick-3d look-dev editor and
    // future effects) but the production home does NOT bloom — its UnrealBloom
    // added a flower glow /home5 never had, and its non-MSAA render target
    // aliased the grass. HOME_BLOOM flips it back on if ever wanted.
    if (HOME_BLOOM && s.bloomEnabled && !bloomBroken) {
      try {
        composer.render();
      } catch (err) {
        bloomBroken = true;
        console.warn('[sidekick] bloom composer failed — falling back to direct render', err);
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }
    // pin head-tracked overlays (bond badge / speech bubble): project the head
    // bone (lifted +0.55) to NDC; the canvas maps NDC→layout px. Web does the
    // same via overheadRef (sidekick-canvas.tsx).
    if (opts.onOverhead && ready && bones.head) {
      bones.head.getWorldPosition(overheadV);
      overheadV.y += 0.55;
      overheadV.project(camera);
      opts.onOverhead(overheadV.x, overheadV.y, overheadV.z < 1);
    }
    // NOTE: no in-app pixel readback here — every readback path (takeSnapshotAsync,
    // gl.readPixels on the default framebuffer, readRenderTargetPixels on an FBO)
    // hard-hangs expo-gl on the New Architecture and freezes this loop. The dev
    // debug loop captures the Simulator WINDOW from the host instead
    // (scripts/sim-snap.sh → macOS screencapture, which does composite the GL layer).
    if (__DEV__ && ++snapFrame % 600 === 0) {
      console.log('[sidekick] heartbeat frame', snapFrame);
    }
    gl.endFrameEXP();
  };
  animate();

  return {
    setFraming: (f) => {
      framing = f;
    },
    setHoldingPhone: (v) => {
      holdingPhone = v;
    },
    setTalking: (v) => {
      talking = v;
    },
    setStudio: (v) => {
      studio = v;
    },
    setCosmos: (v) => {
      cosmos = v;
    },
    setStarFace: (c) => starFace.setConfig(c),
    setEnvironment: (id) => {
      environment = id;
    },
    setDailyBox: (tier) => {
      dailyBox = tier;
    },
    popDailyBox: () => {
      if (boxPop < 0) boxPop = clock.getElapsedTime();
    },
    applySettings: (next) => {
      const prevHeight = s.grassHeight;
      const prevClumping = s.grassClumping;
      s = next;
      const nsc = next.scenes[next.timeOfDay];
      // sky background — refill the SAME texture in place (no swap, no flash)
      fillGradientTexture(skyTex, skyStops(nsc));
      // fog (mutated in place so the studio crossfade's reference stays valid)
      meadowFog.color.set(nsc.fog);
      meadowFog.near = nsc.fogNear;
      meadowFog.far = nsc.fogFar;
      // light rig + exposure
      hemi.color.set(nsc.hemiSky);
      hemi.groundColor.set(nsc.hemiGround);
      hemi.intensity = nsc.hemiIntensity;
      key.color.set(nsc.keyColor);
      key.intensity = nsc.keyIntensity;
      fill.color.set(nsc.fillColor);
      fill.intensity = nsc.fillIntensity;
      rim.color.set(nsc.rimColor);
      rim.intensity = nsc.rimIntensity;
      renderer.toneMappingExposure = nsc.exposure;
      // meadow
      grass.setColors(nsc.grassHill, nsc.grassBase, nsc.grassTip, nsc.rock);
      grass.setClouds(nsc.keyColor, nsc.fog);
      if (next.grassHeight !== prevHeight || next.grassClumping !== prevClumping) {
        grass.relayout(next.grassHeight, next.grassClumping); // 20k matrices — only on change
      }
      // character + cosmetics + face placement — uniform updates only, never a
      // material rebuild (rebuilds flash)
      retintShading?.();
      cos?.retint(next);
      faceCtl?.setScale(next.faceZoom);
      faceCtl?.setOffsetY(next.faceHeight);
      // bloom
      bloomPass.strength = next.bloomStrength;
      bloomPass.radius = next.bloomRadius;
      bloomPass.threshold = next.bloomThreshold;
    },
    pointerDown: interact.down,
    pointerMove: interact.move,
    pointerUp: interact.up,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      opts.onControls?.(null);
      cos?.dispose();
      renderer.dispose();
    },
  };
}
