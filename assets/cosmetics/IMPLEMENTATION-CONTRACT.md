# Cosmetics — implementation handoff contract

For the agent building the runtime. Read `cosmetics-system.md` (design),
`CANONICAL-SKELETON.md` (authoring invariants), then this. All four slot GLBs +
variant textures + `manifest.json` are delivered under `public/cosmetics/`. Your
job: build `CosmeticsController` and wire it into `/home3`, `/home4`,
`/sidekick-3d`. The asset side is frozen; this is the exact contract it guarantees.

## What is delivered

```
cosmetics/
  manifest.json
  shirt/ base-v1.glb  sky.webp coral.webp dots.webp        (skinned)
  pants/ base-v1.glb  denim.webp khaki.webp                (skinned)
  hat/   base-v1.glb  forest.webp berry.webp               (rigid → Head)
  shoes/ base-v1.glb  red.webp white.webp                  (rigid → L_Calf/R_Calf)
```

Each base GLB was authored against the canonical skeleton (a copy of the shipped
character `yellow_final_v8.glb`), so bone names, hierarchy, and **bind pose are
byte-identical** to the live character. That identity is the precondition every
runtime attach below relies on.

## Manifest schema (authoritative)

```jsonc
{
  "<slot>": {
    "model": "/cosmetics/<slot>/base-v1.glb",
    "attach": "skinned" | "bone:<BoneName>",
    "meshes": { "<MeshName>": "<BoneName>", ... },   // rigid multi-mesh only (shoes)
    "variants": [
      { "id": "...", "name": "...", "tex": "/cosmetics/<slot>/<x>.webp",
        "roughness"?: number, "metalness"?: number, "emissive"?: "#rrggbb", "tint"?: "#rrggbb" }
    ]
  }
}
```
- `shirt`, `pants`: `attach: "skinned"`, single primitive.
- `hat`: `attach: "bone:Head"`, single primitive.
- `shoes`: `attach: "bone:Calf"` **plus** a `meshes` map routing `Shoe_L → L_Calf`,
  `Shoe_R → R_Calf`. Both shoe meshes share ONE material (`ShoeMat`), so a variant
  swap drives both. This is the agreed two-target rigid convention — route by the
  `meshes` map (falling back to each mesh's parent bone node in the GLB, which is
  already correct).

## Per-GLB structural guarantees (verified)

| slot  | primitive(s)          | material   | skinned | GLB parent node        |
|-------|-----------------------|------------|---------|------------------------|
| shirt | `Shirt`               | `ShirtMat` | yes     | (skin → full armature) |
| pants | `Pants`               | `PantsMat` | yes     | (skin → full armature) |
| hat   | `Hat`                 | `HatMat`   | no      | child of `Head`        |
| shoes | `Shoe_L`, `Shoe_R`    | `ShoeMat`  | no      | children of L/R `Calf` |

All: own material (never the body's), **no normal map**, raw ~0.20u scale, faces
`+X`. Skinned GLBs embed the full 42-joint armature (all 13 app bones present by
exact name). Rigid meshes are children of their bone node with the correct
bone-local transform baked in.

## `CosmeticsController` API to implement

Owns the character's live skeleton + bone map (same `BONE_MAP` as
`sidekick-canvas.tsx`). Textures load on demand + cache; cap resident to equipped
+ recently-used.

- `equip(slot, variantId)` — lazy-load & cache the slot base GLB, attach, apply variant.
- `setVariant(slot, variantId)` — swap `material.map` (+ params) only. No reload.
- `unequip(slot)` — detach + dispose geometry/material/texture.

### Attach: skinned (shirt, pants)
1. Load GLB; find its `SkinnedMesh`.
2. Build a NEW `THREE.Skeleton` from the **character's live bones**, one per entry
   of the garment skeleton's `bones` array, **matched by name, in the garment's
   original bone order** (so the mesh's `skinIndex` stays valid). Reuse the
   garment's `boneInverses` and `bindMatrix` verbatim (valid because the bind pose
   is byte-identical).
3. `garmentMesh.bind(newSkeleton, garmentMesh.bindMatrix)`. Discard the GLB's armature.
4. Add the mesh under the same node as the body (its skeleton, not its parent,
   positions it). `frustumCulled = false`.
- DO NOT run any bounding-box normalization on the cosmetic — the character's
  bones already carry the model's `1/height` normalization; the garment rides it.

### Attach: rigid (hat, shoes)
1. Load GLB; for each cosmetic mesh, read its **local transform relative to its
   bone-node parent** in the GLB (`Head`, or `L_Calf`/`R_Calf`).
2. Re-parent the mesh to the **character's** live bone of that name (from the
   manifest `attach`/`meshes`), applying that same local transform. Discard the
   GLB armature.
3. Hat: one mesh → `Head`. Shoes: `Shoe_L` → `L_Calf`, `Shoe_R` → `R_Calf`.
- Same normalization note: parenting to the live (already-scaled) bone gives the
  correct final size for free; do not pre-scale.

### Variant (all slots)
- `material.map = tex`; `tex.colorSpace = SRGBColorSpace`, `flipY = false` (glTF),
  `tex.anisotropy` sensible. Apply optional `roughness`/`metalness`/`emissive`/
  `tint` from the manifest variant. Shoes: one `ShoeMat` → the swap covers both meshes.

## Shading + outline integration
- Build each cosmetic's material from the SAME per-mode factories the body uses
  (`makeSssMaterial` / `makeStylizedMaterial` / `makePhysicalMaterial` in
  `sidekick-shading.ts`), passing the item's `TexSet`, so cosmetics match the
  active shading mode + look-dev settings. Add a `makeItemMaterial(s, texSet, params)`
  dispatcher.
- Extend the inverted-hull outline + poke/drag hit-targets to include equipped
  cosmetics (skinned: bind an outline clone to the same rebuilt skeleton).
- **Outline layering caveat:** the shirt/pants sit ~1.5–1.7% outside the body and
  the body's outline hull is also outside the body. When a torso/leg garment is
  equipped, either outline the garment (not the covered body) or ensure the
  garment's offset exceeds the outline offset, so the body outline doesn't poke
  through the garment.

## Detection note
Cosmetics are **separate GLBs loaded by the controller** — they do NOT go through
the character-GLB `traverse` that splits body vs FaceSprite by "has map." The
character GLB is unchanged (body + FaceSprite only). No name-based hack is needed
for cosmetics; the controller owns them.

## Acceptance checklist
- [ ] Equip each slot solo: appears on the character, correct size/orientation,
      no z-fight, no poke-through at rest.
- [ ] Pose spine/waist/arms → shirt follows; thighs/calves → pants follow; head
      turn → hat follows; leg raise → each shoe follows its own calf.
- [ ] `setVariant` swaps texture with no reload; shoes: one swap changes both.
- [ ] All four equipped together layer correctly (shirt over pants waist; hat on
      crown; shoes on feet). Character still ~1.0 tall on screen, feet at origin.
- [ ] `unequip` fully releases GPU resources.
