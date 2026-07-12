# Cosmetics system — swappable equipment slots

Plan for Glim's modular equipment: **4 slots** (shirt, pants, hat, shoes), each a
**single base model** that accepts **many swappable textures**. Read `README.md`
(character overview) first; `shirt-spec.md` is the first slot's build spec.

## Locked decisions

1. **Attachment is split by how the item moves:**
   - **Skinned** (deforms with the body): **shirt, pants** — bound to the shared
     skeleton.
   - **Rigid** (parented to a bone, no skinning): **hat → `Head`**,
     **shoes → `L_Calf` / `R_Calf`** (there's no foot bone, so feet are already
     rigid relative to the calf — exact and simple).
2. **Assets live in-repo** under `public/cosmetics/` for now (versioned with code,
   works offline). Revisit a bucket/CDN if the texture library outgrows the repo.
3. **A variant = an albedo texture + optional material params** (roughness,
   emissive, tint) in the manifest — enables satin/neon/metallic looks, not just
   flat recolors.

## Core model

- **One GLB per slot** = geometry + UVs + one material slot. Authored + versioned
  independently, lazy-loaded, swapped wholesale to change the *base*.
- **Variant = a texture** painted into the slot's **single shared UV layout**.
  Every variant of a slot reuses that layout, which is *why* textures are
  interchangeable. Swapping a variant is just `material.map = tex` — no reload.
- **Manifest-driven**: one JSON registry drives both loading and the picker UI.
  Adding a skin = drop a texture + one manifest line (no code). Adding a slot
  base = one GLB + one entry.

## File layout (`public/cosmetics/`)

```
cosmetics/
  manifest.json
  shirt/  base-v1.glb  varsity.webp  hawaiian.webp ...
  pants/  base-v1.glb  denim.webp    cargo.webp    ...
  hat/    base-v1.glb  cap.webp      beanie.webp   ...
  shoes/  base-v1.glb  sneaker.webp  boot.webp     ...
```

## Manifest schema

```jsonc
{
  "shirt": {
    "model": "/cosmetics/shirt/base-v1.glb",
    "attach": "skinned",
    "variants": [
      { "id": "varsity",  "name": "Varsity",  "tex": "/cosmetics/shirt/varsity.webp" },
      { "id": "hawaiian", "name": "Hawaiian", "tex": "/cosmetics/shirt/hawaiian.webp",
        "roughness": 0.4, "emissive": "#000000" }
    ]
  },
  "hat":   { "model": "/cosmetics/hat/base-v1.glb",   "attach": "bone:Head",   "variants": [ /* ... */ ] },
  "shoes": { "model": "/cosmetics/shoes/base-v1.glb", "attach": "bone:Calf",   "variants": [ /* ... */ ] },
  "pants": { "model": "/cosmetics/pants/base-v1.glb", "attach": "skinned",     "variants": [ /* ... */ ] }
}
```
`attach`: `"skinned"` | `"bone:<BoneName>"`. Optional per-variant params override
the slot's default material (roughness, metalness, emissive, tint).

## Runtime: `CosmeticsController`

One module shared by `/home3`, `/home4`, `/sidekick-3d`. Owns the character's live
skeleton + bone map. API:

- `equip(slot, variantId)` — lazy-load + cache the slot's base GLB, then attach:
  - **skinned** → rebind the loaded `SkinnedMesh` to the **character's** skeleton
    by matching bone names, and discard the GLB's duplicate armature.
  - **rigid** → parent the mesh to the named bone (shoes: two meshes → L/R calf).
  - apply the variant texture + params.
- `setVariant(slot, variantId)` — swap `material.map` (+ params) only. Cheap.
- `unequip(slot)` — detach + dispose geometry/material/texture.

Textures load on demand and are cached; only equipped (+ recently-used) textures
stay resident. Cap variant textures at 512–1024²; WebP now, KTX2/Basis later if
the library grows.

## Shading integration

Item materials are built from the **same** per-mode factories the body uses
(`makeSssMaterial` / `makeStylizedMaterial` / `makePhysicalMaterial` in
`sidekick-shading.ts`), passing the item's `TexSet`. So every cosmetic
automatically matches the active shading mode + look-dev settings and can get the
inverted-hull outline. Add a `makeItemMaterial(s, texSet, params)` dispatcher.

## Authoring contract (Blender)

**Canonical skeleton (critical for skinned slots):** keep ONE master `.blend`
holding the character rig. Author every skinned garment in it and export each
garment **with the armature**. Bone names, hierarchy, and bind pose must be
byte-identical to the character (from `yellow_final_v8.glb`), or runtime
rebinding fails. The 13 bones: `Head`, `Waist`, `Spine01`, `L/R_Upperarm`,
`L/R_Forearm`, `L/R_Hand`, `L/R_Thigh`, `L/R_Calf`.

Per slot:
- **One material slot, one consistent UV layout** — the coordinate system every
  future variant paints into. Lock it before authoring variants.
- **Skinned (shirt, pants):** fit over the body with a ~1–2% outward offset;
  transfer vertex weights from the body (Data Transfer, nearest-face
  interpolated); verify posing spine/waist/thigh deforms it cleanly with no
  poke-through. Single primitive.
- **Rigid (hat, shoes):** model in place at the correct bone-local position with
  the **object origin at the attach point**, so parenting needs no offset. Shoes:
  two meshes (L/R) or one mesh with two islands, each meant for its calf.
- Same raw scale (~0.20u) + `+X` orientation as the body; the app auto-normalizes
  the character and the cosmetics ride along.
- Deliver one GLB per slot: `cosmetics/<slot>/base-v1.glb`.

## Build order

1. **Shirt** (first skinned slot) as a standalone `cosmetics/shirt/base-v1.glb`
   + a minimal `CosmeticsController` with one hardcoded variant. Proves skinned
   rebinding end-to-end.
2. Generalize to the **manifest** + texture-swap (`setVariant`).
3. **Hat** (first rigid slot) — proves the bone-parent path.
4. **Pants** + **shoes**.
5. **Cosmetics picker UI** driving `equip` / `setVariant`.

## Reconciling `shirt-spec.md`

`shirt-spec.md` predates this system and assumed the shirt would be baked into the
character GLB as a third primitive. Under the cosmetics system the shirt is
instead a **standalone slot GLB** (`cosmetics/shirt/base-v1.glb`) authored against
the canonical skeleton and rebound at runtime. Everything else in that spec still
holds (fit, offset, weight transfer, single material, single UV, low poly). The
"name it `Shirt`, app keys on name" hook is superseded by the manifest — the app
finds the SkinnedMesh in the standalone GLB and rebinds it; naming is no longer
load-bearing.
