import * as THREE from 'three';

import { deinterleaveGeometry, loadGLB, loadItemTexture } from './assets';
import { MANIFEST, type Manifest, type SlotDef, type Variant } from './cosmetics-manifest';
import {
  makeItemMaterial,
  makeOutlineMaterial,
  retintCelMaterial,
  retintOutlineMaterial,
  type ItemLook,
} from './shading';
import type { SidekickSettings } from './settings';

// Ported from sidekick/src/components/sidekick-equipment.ts. Each slot ships as
// its own standalone GLB authored against the SAME rig as the character, never
// baked into the character. At runtime we load a slot GLB and attach it two ways:
//   • "skinned"  (shirt, pants) → rebind its SkinnedMesh to the character's live
//     skeleton by matching bone names, so it deforms with the body.
//   • "bone:<Name>" (hat, shoes, phone) → parent the mesh to the named character
//     bone, preserving its authored rest placement, so it rides that bone rigidly.
// A variant = an albedo texture (+ optional PBR params); swapping is just a
// material/map change, no reload. Everything is manifest-driven.
//
// RN deltas from the web version: the manifest is a bundled module (no fetch),
// GLBs/textures load through expo-asset, cloned geometry is de-interleaved for
// expo-gl, and item materials are the self-contained skinned cel shader (the
// built-in lit materials render invisible when skinned on expo-gl).

export type CosmeticsHandle = {
  ready: Promise<void>;
  slots: () => Manifest;
  equip: (slot: string, variantId?: string) => Promise<void>;
  setVariant: (slot: string, variantId: string) => void;
  // solid-color override for a slot (replaces its texture); null clears it back
  // to the current variant's texture/pattern.
  setColor: (slot: string, color: string | null) => void;
  unequip: (slot: string) => void;
  setVisible: (slot: string, on: boolean) => void;
  // rebuild all equipped materials for changed settings (live look-dev)
  refresh: (s: SidekickSettings) => void;
  // uniform-only retint (no material rebuild — flash-free live tuning)
  retint: (s: SidekickSettings) => void;
  // pointer hit-targets to fold into the poke/drag interaction
  targets: () => THREE.Object3D[];
  dispose: () => void;
};

type Equipped = {
  def: SlotDef;
  meshes: THREE.Mesh[]; // one for skinned/hat, possibly two for shoes
  outline: THREE.SkinnedMesh | null;
  variantId: string;
  color?: string; // solid-color override; when set it replaces the variant's texture
};

export function createCosmetics(
  bodyMesh: THREE.SkinnedMesh,
  settings: SidekickSettings,
): CosmeticsHandle {
  const manifest: Manifest = MANIFEST;
  let lastS = settings;
  let disposed = false;
  const equipped = new Map<string, Equipped>();
  const gltfCache = new Map<number, Promise<THREE.Group>>();
  const texCache = new Map<number, THREE.Texture>();
  const charBoneByName = new Map(bodyMesh.skeleton.bones.map((b) => [b.name, b]));

  // the manifest is bundled — nothing to fetch (kept for web API parity)
  const ready = Promise.resolve();

  const loadGltf = (moduleRef: number): Promise<THREE.Group> => {
    let p = gltfCache.get(moduleRef);
    if (!p) {
      p = loadGLB(moduleRef).then((g) => g.scene);
      gltfCache.set(moduleRef, p);
    }
    return p;
  };

  // never rejects: a missing/failed texture resolves null so the variant just
  // falls back to its solid color.
  const loadTex = async (moduleRef: number): Promise<THREE.Texture | null> => {
    const cached = texCache.get(moduleRef);
    if (cached) return cached;
    try {
      const t = await loadItemTexture(moduleRef);
      texCache.set(moduleRef, t);
      return t;
    } catch (e) {
      console.warn('[cosmetics] texture load failed, using color', e);
      return null;
    }
  };

  // resolve a variant's look (color falls back to slot default → shirtColor)
  const lookFor = (def: SlotDef, v: Variant, map: THREE.Texture | null): ItemLook => ({
    color: v.color ?? def.defaultColor ?? lastS.shirtColor,
    map,
  });

  const applyVariant = (slot: string) => {
    const eq = equipped.get(slot);
    if (!eq) return;
    const v = eq.def.variants.find((x) => x.id === eq.variantId) ?? eq.def.variants[0];
    // a solid-color override wins over the variant's texture (the shading
    // factories treat map + color as mutually exclusive)
    const map = eq.color ? null : v.tex ? (texCache.get(v.tex) ?? null) : null;
    const look: ItemLook = eq.color ? { color: eq.color, map: null } : lookFor(eq.def, v, map);
    for (const mesh of eq.meshes) {
      (mesh.material as THREE.Material).dispose();
      mesh.material = makeItemMaterial(lastS, look);
    }
    if (eq.outline) {
      (eq.outline.material as THREE.Material).dispose();
      eq.outline.material = makeOutlineMaterial(lastS);
      eq.outline.visible = eq.meshes[0]?.visible !== false && lastS.outline;
    }
  };

  const attachSkinned = (scene: THREE.Group, def: SlotDef): Equipped => {
    let item: THREE.SkinnedMesh | null = null;
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) item = o as THREE.SkinnedMesh;
    });
    const shirt = item as unknown as THREE.SkinnedMesh;
    const geo = shirt.geometry as THREE.BufferGeometry;
    deinterleaveGeometry(geo);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    shirt.normalizeSkinWeights();
    // rebind the slot's skin to the CHARACTER's bones, matched by name
    const bones = shirt.skeleton.bones.map((b) => charBoneByName.get(b.name) ?? b);
    const skel = new THREE.Skeleton(bones, shirt.skeleton.boneInverses);
    shirt.frustumCulled = false;
    bodyMesh.parent!.add(shirt);
    shirt.position.set(0, 0, 0);
    shirt.quaternion.identity();
    shirt.scale.setScalar(1);
    shirt.bind(skel, shirt.bindMatrix);
    // its own inverted-hull outline (rides ~1.7% outside the body so it hides
    // the body's outline across the torso)
    const outline = new THREE.SkinnedMesh(geo, makeOutlineMaterial(lastS));
    outline.bind(skel, shirt.bindMatrix);
    outline.frustumCulled = false;
    bodyMesh.parent!.add(outline);
    return { def, meshes: [shirt], outline, variantId: def.variants[0].id };
  };

  // Rigid: the slot is authored as a non-skinned mesh parented to a bone in an
  // IDENTICAL rig (e.g. the hat under "Head"), so its node transform is already
  // bone-local. We reparent it to the character's matching bone and copy that
  // authored local transform verbatim — the character's bone carries the
  // runtime normalization (scale/placement) via its parent chain, so the item
  // inherits it for free and then rides the bone.
  const attachRigid = (scene: THREE.Group, def: SlotDef, boneName: string): Equipped => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) {
        meshes.push(o as THREE.Mesh);
      }
    });
    for (const mesh of meshes) {
      deinterleaveGeometry(mesh.geometry as THREE.BufferGeometry);
      // prefer the bone the artist actually parented it under; fall back to the
      // manifest's bone. Shoes: a mesh named ...R... rides the right calf.
      const authored = mesh.parent?.name ? charBoneByName.get(mesh.parent.name) : undefined;
      let target = authored ?? charBoneByName.get(boneName);
      if (!target && boneName === 'Calf') {
        const side = /(^|[^a-z])r([^a-z]|$)|right/i.test(mesh.name) ? 'R' : 'L';
        target = charBoneByName.get(`${side}_Calf`);
      }
      if (!target) continue;
      const pos = mesh.position.clone();
      const quat = mesh.quaternion.clone();
      const scl = mesh.scale.clone().multiplyScalar(def.scale ?? 1);
      if (def.rotate) {
        // rotate in bone space about the bone origin (head center for head
        // items), not the mesh origin — so a tilted hat pivots on the head
        const r = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...(def.rotate.map(THREE.MathUtils.degToRad) as [number, number, number])),
        );
        pos.applyQuaternion(r);
        quat.premultiply(r);
      }
      if (def.offset) pos.add(new THREE.Vector3().fromArray(def.offset));
      target.add(mesh);
      mesh.position.copy(pos);
      mesh.quaternion.copy(quat);
      mesh.scale.copy(scl);
      mesh.frustumCulled = false;
    }
    return { def, meshes, outline: null, variantId: def.variants[0].id };
  };

  return {
    ready,
    slots: () => manifest,
    equip: async (slot, variantId) => {
      if (disposed) return;
      const def = manifest[slot];
      if (!def) {
        console.warn(`[cosmetics] no such slot: ${slot}`);
        return;
      }
      const want = variantId ?? equipped.get(slot)?.variantId ?? def.variants[0].id;
      if (equipped.has(slot)) {
        const cur = equipped.get(slot) as Equipped;
        cur.meshes.forEach((m) => (m.visible = true));
        const v = def.variants.find((x) => x.id === want);
        if (v?.tex) await loadTex(v.tex);
        cur.variantId = want;
        // switching to an explicit pattern clears any solid-color override
        if (variantId) cur.color = undefined;
        applyVariant(slot);
        return;
      }
      const scene = (await loadGltf(def.model)).clone(true);
      if (disposed) return;
      const eq =
        def.attach === 'skinned'
          ? attachSkinned(scene, def)
          : attachRigid(scene, def, def.attach.replace(/^bone:/, ''));
      eq.variantId = want;
      equipped.set(slot, eq);
      const v = def.variants.find((x) => x.id === want);
      if (v?.tex) await loadTex(v.tex);
      applyVariant(slot);
    },
    setVariant: (slot, variantId) => {
      const eq = equipped.get(slot);
      if (!eq) return;
      eq.variantId = variantId;
      eq.color = undefined; // picking a pattern clears the solid-color override
      const v = eq.def.variants.find((x) => x.id === variantId);
      if (v?.tex && !texCache.has(v.tex)) {
        loadTex(v.tex).then(() => applyVariant(slot));
      } else {
        applyVariant(slot);
      }
    },
    setColor: (slot, color) => {
      const eq = equipped.get(slot);
      if (!eq) return;
      eq.color = color ?? undefined;
      if (!color) {
        // reverting to the pattern — make sure its texture is loaded first
        const v = eq.def.variants.find((x) => x.id === eq.variantId);
        if (v?.tex && !texCache.has(v.tex)) {
          loadTex(v.tex).then(() => applyVariant(slot));
          return;
        }
      }
      applyVariant(slot);
    },
    unequip: (slot) => {
      const eq = equipped.get(slot);
      if (!eq) return;
      for (const o of [...eq.meshes, eq.outline]) {
        if (!o) continue;
        o.parent?.remove(o);
        (o.material as THREE.Material).dispose();
      }
      equipped.delete(slot);
    },
    setVisible: (slot, on) => {
      const eq = equipped.get(slot);
      if (!eq) return;
      eq.meshes.forEach((m) => (m.visible = on));
      if (eq.outline) eq.outline.visible = on && lastS.outline;
    },
    refresh: (s2) => {
      lastS = s2;
      for (const slot of equipped.keys()) applyVariant(slot);
    },
    retint: (s2) => {
      lastS = s2;
      for (const eq of equipped.values()) {
        const v = eq.def.variants.find((x) => x.id === eq.variantId) ?? eq.def.variants[0];
        // mapped items keep uColor = tint (white); solid items use their color
        const hasMap = !eq.color && !!v.tex && texCache.has(v.tex);
        const override = hasMap
          ? undefined
          : (eq.color ?? v.color ?? eq.def.defaultColor ?? lastS.shirtColor);
        for (const mesh of eq.meshes) retintCelMaterial(mesh.material as THREE.Material, lastS, override);
        if (eq.outline) retintOutlineMaterial(eq.outline.material as THREE.Material, lastS);
      }
    },
    targets: () => [...equipped.values()].flatMap((eq) => eq.meshes),
    dispose: () => {
      disposed = true;
      for (const slot of [...equipped.keys()]) {
        const eq = equipped.get(slot)!;
        for (const o of [...eq.meshes, eq.outline]) {
          if (!o) continue;
          o.parent?.remove(o);
          (o.material as THREE.Material).dispose();
        }
      }
      equipped.clear();
      texCache.forEach((t) => t.dispose());
      texCache.clear();
    },
  };
}
