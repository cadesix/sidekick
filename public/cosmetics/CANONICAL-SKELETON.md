# Canonical skeleton — provenance

All **skinned** cosmetics (shirt, pants) must bind to a skeleton that is
**byte-identical** (bone names, hierarchy, bind pose) to the shipped character,
or runtime rebinding in `CosmeticsController` produces wrong deformation.

## Source of truth
- **`~/Desktop/char-pipeline/blender/character_master.blend`** — the canonical
  rig, a direct copy of the shipped character `mesh/yellow_final_v8.glb`
  (body + FaceSprite + 41-bone armature). Do **not** regenerate the rig; author
  every skinned garment against *this* file.

## How garments are authored (reproducible)
Garments are built by script from the master, not hand-modeled, so the bind pose
can never drift:
- **Shirt:** `~/Desktop/char-pipeline/scripts/build_shirt.py` — duplicates the
  body's torso+upper-arm surface (so it inherits the body's exact vertex weights,
  better than a Data Transfer), clean-cuts hem/cuffs, offsets ~1.7% outward,
  decimates to ~1.5k tris, solidifies for cloth thickness, single `ShirtMat`
  material, exports **Shirt + Armature only** to `cosmetics/shirt/base-v1.glb`.

## Invariants every skinned garment GLB guarantees
- One primitive, one material (its own, not the body's), no normal map.
- Skinned to the full armature; the 13 app bones present by exact name.
- Same raw ~0.20u scale + `+X` facing as the body (never pre-scaled).
- Fits ~1–2% outside the body; deforms cleanly with spine/waist/arm, no
  poke-through at rest or mild idle poses (verify sleeves under arm sway).

## UV layout is locked per slot
`base-v1`'s UV is the coordinate system every future shirt variant paints into.
Changing it means re-painting all variants — only bump to `base-v2` for a
deliberate, variant-breaking UV change.

## Slots built so far
- **Shirt** (skinned): `scripts/build_shirt.py` → `cosmetics/shirt/base-v1.glb`
  (840v / 1688 tris). Variants: `sky.webp`, `coral.webp`, `dots.webp`.
- **Pants** (skinned): `~/Desktop/char-pipeline/scripts/build_pants.py` →
  `cosmetics/pants/base-v1.glb` (960v / 1928 tris). Duplicates the body's
  lower-body surface; waistband bisected at z=0.050 (tucks under the shirt hem,
  offset 0.0026 < shirt's 0.0034 so the shirt layers over), ankle cuffs bisected
  at z=0.014 (one z-plane cuts both leg tubes). Variants: `denim.webp`, `khaki.webp`.
- **Hat** (rigid, `bone:Head`): `~/Desktop/char-pipeline/scripts/build_hat.py`
  → `cosmetics/hat/base-v1.glb` (262v / 520 tris). Beanie on the crown; origin
  set to the Head-bone attach point and parented to `Head`, exported with the
  armature so the `Hat` node is a child of the `Head` node (app re-parents it to
  the character's live `Head` bone; it is NOT skinned). Variants: `forest.webp`,
  `berry.webp`.

`manifest.json` registers both slots + all variants.
- **Shoes** (rigid, two meshes): `~/Desktop/char-pipeline/scripts/build_shoes.py`
  → `cosmetics/shoes/base-v1.glb`. `Shoe_L`→`L_Calf`, `Shoe_R`→`R_Calf` (feet are
  rigid relative to the calf; no foot bone). Each duplicates that foot's surface,
  offset out, ankle rim at z=0.021, solidified; both share ONE `ShoeMat`. Variants:
  `red.webp`, `white.webp`. All four slots now built.
