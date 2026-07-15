import { type ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

import { deinterleaveGeometry, loadGLB, loadTexture } from './assets';
import { createCosmetics, type CosmeticsHandle } from './cosmetics';
import { configureFaceTexture, createFaceController, type FaceController } from './face';
import {
  makeCharacterMaterials,
  makeOutlineMaterial,
  retintCelMaterial,
  type TexSet,
} from './shading';
import { loadSettings, type SidekickSettings } from './settings';
import { loadWardrobe, type WardrobeSlot } from './wardrobe';

// The RN analog of web's <SidekickAvatar>. Web renders a one-shot offscreen
// snapshot of the character's HEAD to a data URL and reuses it as an <img>
// everywhere — impossible on expo-gl, where any GL readback (readPixels /
// takeSnapshotAsync) hard-hangs the context. So each avatar is a small LIVE
// GLView rendering just the head: the same rig, cel shading (purple body),
// smiling face, and worn head-region cosmetics (hats + glasses) as the main
// scene, framed dead-on. Keep instances few — every GLView is its own GL
// context (browsers cap at ~16; native GPU cost adds up).

const MASCOT_GLB = require('../../assets/models/sidekick-rigged.stripped.glb');
const FACE_SHEET = require('../../assets/textures/face-sheet-v6.png');

// only the head-region slots matter for a head shot (mirrors web HEAD_SLOTS)
const HEAD_SLOTS: WardrobeSlot[] = ['hat', 'beanie', 'bucket', 'wizard', 'crown', 'glasses'];

export type AvatarController = {
  // freeze/resume the render loop. The head is essentially static (only the
  // blink animates), so pausing it while a heavy sheet is open frees the GPU
  // with no visible change.
  setPaused: (v: boolean) => void;
  dispose: () => void;
};

// Collapse every vertex that isn't majority-skinned to the Head bone onto the
// neck point inside the head shell — the same purely-geometric carve web uses
// (immune to the cel shader ignoring renderer clip planes). Boundary triangles
// taper into the interior where the head hides them.
function carveHead(body: THREE.SkinnedMesh): void {
  const geo = (body.geometry as THREE.BufferGeometry).clone(); // don't mutate the shared GLB geometry
  body.geometry = geo;
  const headIdx = body.skeleton.bones.findIndex((b) => b.name === 'Head');
  if (headIdx < 0) return;
  const bind = new THREE.Matrix4().copy(body.skeleton.boneInverses[headIdx]).invert();
  const neck = new THREE.Vector3().setFromMatrixPosition(bind);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const sIdx = geo.attributes.skinIndex as THREE.BufferAttribute;
  const sW = geo.attributes.skinWeight as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let headWeight = 0;
    for (let k = 0; k < 4; k++) if (sIdx.getComponent(i, k) === headIdx) headWeight += sW.getComponent(i, k);
    if (headWeight < 0.5) pos.setXYZ(i, neck.x, neck.y, neck.z);
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

// Frame the ACTUAL remaining geometry (post-carve the body's bounds ARE the
// head) plus any worn cosmetics, dead-on from +X, so wide ears / crown spikes /
// tall hats never crop. No model normalization needed — the camera distance is
// derived from the head's own span, so absolute scale is irrelevant.
function frameHead(body: THREE.SkinnedMesh, cos: CosmeticsHandle, camera: THREE.PerspectiveCamera): void {
  body.updateWorldMatrix(true, true);
  const geo = body.geometry as THREE.BufferGeometry;
  geo.computeBoundingBox();
  const frame = geo.boundingBox!.clone().applyMatrix4(body.matrixWorld);
  for (const m of cos.targets()) frame.expandByObject(m);
  frame.expandByScalar(0.015);
  const center = frame.getCenter(new THREE.Vector3());
  const span = frame.getSize(new THREE.Vector3()).length();
  const dir = new THREE.Vector3(1, 0.05, 0).normalize(); // model faces +X raw
  const dist = (span / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.08;
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
}

export function createAvatarRenderer(gl: ExpoWebGLRenderingContext): AvatarController {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;

  // neutral daytime tint, like web's product-shot avatar (no time-of-day cast)
  const s: SidekickSettings = { ...loadSettings(), timeOfDay: 'day' };

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#c8cbd8', 0.9));
  const key = new THREE.DirectionalLight('#fff4dc', 1.5);
  key.position.set(3, 4, 3);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(32, width / height, 0.01, 20);

  const renderer = new Renderer({ gl }) as unknown as THREE.WebGLRenderer;
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0); // transparent — the avatar floats on the UI

  let disposed = false;
  let paused = false;
  let raf = 0;
  let faceCtl: FaceController | null = null;
  let cos: CosmeticsHandle | null = null;
  let faceTexture: THREE.Texture | null = null; // hoisted so dispose() can free it
  const clock = new THREE.Clock();

  // dispose every geometry + material under a subtree (own GPU resources only —
  // loadGLB re-parses per call, so nothing here is shared with other instances)
  const freeTree = (root: THREE.Object3D) =>
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
      else mat?.dispose?.();
    });

  // free what just finished loading when we were disposed mid-load (dispose()'s
  // traverse already ran and saw an empty scene, so these would otherwise leak)
  const bail = (root: THREE.Object3D) => {
    freeTree(root);
    faceTexture?.dispose();
  };

  (async () => {
    // the face sheet, the character GLB, and the wardrobe are independent —
    // load them concurrently rather than three back-to-back round-trips
    const [faceTex, gltf, wardrobe] = await Promise.all([
      loadTexture(FACE_SHEET)
        .then(configureFaceTexture)
        .catch(() => null), // no face sheet — head renders featureless, still valid
      loadGLB(MASCOT_GLB),
      loadWardrobe(),
    ]);
    faceTexture = faceTex; // let dispose()/bail free it
    if (disposed) {
      bail(gltf.scene);
      return;
    }
    const model = gltf.scene;

    let bodyMesh: THREE.SkinnedMesh | null = null;
    let faceMesh: THREE.SkinnedMesh | null = null;
    const texSet: TexSet = { map: null, normalMap: null, vertexColors: false };
    model.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh) {
        deinterleaveGeometry(child.geometry as THREE.BufferGeometry);
        if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
        const matName = (child.material as THREE.Material).name;
        if (matName === 'FaceSprite') faceMesh = child;
        else bodyMesh = child;
        child.frustumCulled = false;
        child.normalizeSkinWeights();
      }
    });
    if (!bodyMesh) {
      bail(model);
      return;
    }
    const body = bodyMesh as THREE.SkinnedMesh;

    const { body: bodyMat, face: faceMat } = makeCharacterMaterials(s, texSet, faceTex);
    body.material = bodyMat;
    retintCelMaterial(body.material as THREE.Material, s, s.celBodyColor);
    if (faceMesh) {
      const fm = faceMesh as THREE.SkinnedMesh;
      fm.material = faceMat;
      retintCelMaterial(fm.material as THREE.Material, s);
    }

    if (faceTex) {
      faceCtl = createFaceController(faceTex, s.faceZoom, s.faceHeight);
      faceCtl.set('neutral'); // open-eyed smile
      faceCtl.setBlinking(true);
      faceCtl.update(0);
    }

    // carve to the head, THEN build the inverted-hull outline from the carved
    // geometry so the ink line hugs the head only
    carveHead(body);
    const outline = new THREE.SkinnedMesh(body.geometry, makeOutlineMaterial(s));
    outline.bind(body.skeleton, body.bindMatrix);
    outline.frustumCulled = false;
    outline.visible = s.outline;
    body.parent!.add(outline);

    scene.add(model);

    // worn head-region cosmetics, dressed from the saved wardrobe (loaded above)
    cos = createCosmetics(body, s);
    for (const slot of HEAD_SLOTS) {
      const st = wardrobe[slot];
      if (!st?.equipped) continue;
      await cos.equip(slot, st.variantId);
      if (disposed) return;
      if (st.color) cos.setColor(slot, st.color);
    }

    frameHead(body, cos, camera);
  })().catch((e) => console.warn('[sidekick] avatar load failed', e));

  const animate = () => {
    if (disposed || paused) return;
    raf = requestAnimationFrame(animate);
    if (faceCtl) faceCtl.update(clock.getElapsedTime());
    renderer.render(scene, camera);
    gl.endFrameEXP();
  };
  animate();

  return {
    setPaused: (v) => {
      if (v === paused) return;
      paused = v;
      // cancel any frame still queued before restarting, else pause→resume
      // inside one frame would leave two concurrent animate() loops running
      if (!v && !disposed) {
        cancelAnimationFrame(raf);
        animate();
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      // free geometry + materials FIRST, while cosmetic meshes are still in the
      // graph — cos.dispose() only frees cosmetic materials/textures and detaches
      // the meshes, never their geometry, so traversing after it would miss them
      freeTree(scene);
      cos?.dispose(); // cosmetic textures + detach (materials already freed above)
      faceTexture?.dispose();
      renderer.dispose();
    },
  };
}
