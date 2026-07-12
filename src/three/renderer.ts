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
import { makeGrassEnvironment } from './grass';
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
  makeOutlineMaterial,
  retintCelMaterial,
  retintOutlineMaterial,
  syncCelMapTransform,
  SUN_DIR,
  type TexSet,
} from './shading';

// Ported from sidekick/src/components/sidekick-canvas.tsx. The web version ran
// inside a React useEffect against a DOM <canvas>; here it runs against an
// expo-gl context. The scene-graph, bone posing, phone-pose blend and camera
// easing are the same logic; only the renderer/canvas plumbing, the (deferred)
// grass/interaction/cosmetics, and the DOM-canvas sky differ.

// require() the bundled, texture-stripped model (scripts/strip-glb.mjs).
const MASCOT_GLB = require('../../assets/models/sidekick-rigged.stripped.glb');
const FACE_SHEET = require('../../assets/textures/face-sheet-v3.png');

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
export const BUILD_MARKER = 'build-035';

export function createSidekickRenderer(
  gl: ExpoWebGLRenderingContext,
  opts: {
    framing: Framing;
    holdingPhone?: boolean;
    studio?: boolean;
    // handed the imperative dressing controls once cosmetics are ready (and
    // null on dispose) — the Shop sheet drives the live character through it
    onControls?: (c: CosmeticsControls | null) => void;
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
  const skyStops = (p: typeof sc) => [
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
  grass.setLights(sc);
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

  // ---- bloom (matches the web viewer's UnrealBloomPass). expo-gl reports no
  // EXT_color_buffer_float, so every render target in the chain is forced to
  // 8-bit — slight banding in the glow, but renderable. OutputPass applies the
  // ACES/sRGB output transform the direct path gets from rendering to screen.
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType }),
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
  const lerp = THREE.MathUtils.lerp;
  let phoneBlend = 0;
  let phoneShown = false;
  let studioT = 0; // eased meadow→studio blend (0 meadow, 1 studio)
  let raf = 0;
  let snapFrame = 0;
  const studioMat = studioSphere.material as THREE.MeshBasicMaterial;
  const shadowMat = contactShadow.material as THREE.MeshBasicMaterial;

  const animate = () => {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const now = clock.getElapsedTime();
    const fr = interact.update(now);

    // crossfade the meadow out / studio in when the Shop opens (and back)
    const targetT = studio ? 1 : 0;
    studioT += (targetT - studioT) * 0.3;
    if (Math.abs(targetT - studioT) < 0.003) studioT = targetT;
    const inStudio = studioT > 0.001;
    studioSphere.visible = inStudio;
    studioMat.opacity = studioT;
    contactShadow.visible = inStudio;
    shadowMat.opacity = studioT;
    grass.setOpacity(1 - studioT);
    scene.fog = inStudio ? null : meadowFog;

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
      setBone('head', fr.headPitch + PHONE_POSE.headPitch * pb, fr.headYaw + PHONE_POSE.headYaw * pb, 0);
      // body-drag bend splits across waist + spine (arc toward the grab
      // point); the trailing leg lifts and its knee curls when off balance
      setBone('waist', fr.bendX * 0.5, 0, fr.bendZ * 0.5);
      setBone('spine', fr.bendX * 0.5, 0, fr.bendZ * 0.5);
      setBone('thighL', 0, 0, fr.legL.lift);
      setBone('calfL', fr.legL.curl, 0, 0);
      setBone('thighR', 0, 0, fr.legR.lift);
      setBone('calfR', fr.legR.curl, 0, 0);
    }

    // ease camera toward the current framing (smooth zoom on chat open)
    camBasePos.lerp(wantPos.fromArray(framing.pos), 0.07);
    camBaseTarget.lerp(wantTgt.fromArray(framing.target), 0.07);
    const wantFov = framing.fov ?? camera.fov;
    if (Math.abs(wantFov - camera.fov) > 0.02) {
      camera.fov += (wantFov - camera.fov) * 0.07;
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
    if (faceCtl) {
      faceCtl.setTalking(talking);
      faceCtl.update(now);
      if (faceMat && faceSheet) syncCelMapTransform(faceMat, faceSheet);
    }
    if (s.bloomEnabled && !bloomBroken) {
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
      grass.setLights(nsc);
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
