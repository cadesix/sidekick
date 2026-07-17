# Skinned shirt — Blender build spec

A hand-off spec for adding a **shirt garment** to Glim as a third skinned
primitive. Read `README.md` in this folder first for the character overview.

**Scope of THIS task:** a *skinned* shirt that rides the existing rig — no
cloth simulation. It deforms with the body for free (same bones), costs ~nothing
at runtime, and suits the glossy-vinyl-toy look. (Real-time cloth was considered
and deliberately deferred: weeks of solver/collider work for little payoff on an
idling character. A cheap jiggle-bone pass on the hem is a possible *later*
add-on, out of scope here.)

---

## Inputs

- **Base mesh:** `yellow_final_v8.glb (char-pipeline archive)` — the current
  shipped character (body + FaceSprite, humanoid rig). Model the shirt onto
  *this* file and re-export the whole thing.
- **Rig bones (must stay byte-for-byte identical in name):** `Head`, `Waist`,
  `Spine01`, `L_Upperarm`, `R_Upperarm`, `L_Forearm`, `R_Forearm`, `L_Hand`,
  `R_Hand`, `L_Thigh`, `R_Thigh`, `L_Calf`, `R_Calf`.

## Character constraints (do NOT change)

- **Orientation:** model faces **+X** in raw space (the app rotates it to face
  the camera). Don't reorient.
- **Scale:** raw character is ~0.20 units tall; the app auto-normalizes the whole
  glTF to 1.0 and stands feet on y=0. Model the shirt in the **same raw scale**
  as the body so it rides along — do not pre-scale it.
- **Leave the body and FaceSprite untouched** — same geometry, same UVs, same
  embedded albedo texture. Only *add* the shirt; don't retopo or move anything
  existing.

---

## 1. Model the garment

- **Start simple: a sleeveless tank / tee that covers the torso only.** Glim has
  stubby arms and no real shoulder/neck definition, so sleeves invite
  poke-through and collision headaches — skip them for v1. (Short sleeves are a
  possible stretch goal once v1 lands.)
- **Fit with a small outward offset.** The shirt shell must sit ~1–2% of body
  size *outside* the body surface everywhere, so it never z-fights or pokes
  through when the torso breathes/bends. A Shrinkwrap-to-body + small Solidify/
  push-out, then hand-cleanup, is the easy route.
- **Topology:** keep it light — a few hundred to ~1.5k tris is plenty. Quads
  preferred, with clean edge loops around the neck hole, arm holes, and hem so
  skinning deforms without pinching.
- **Silhouette:** a chunky, slightly loose tee reads best against the round toy
  body — avoid skin-tight (looks painted-on) and avoid long/flowy (needs sim).

## 2. Bind it to the rig (skinning)

The shirt must deform with the *same* bones as the body:

1. Give the shirt an **Armature modifier** pointing at the existing rig.
2. **Transfer skin weights from the body:** select shirt, add a **Data Transfer**
   modifier (or Weight Transfer), source = body mesh, Vertex Data → **Vertex
   Groups**, mapping = *Nearest Face Interpolated*; Apply. This copies the body's
   per-vertex bone weights onto the shirt so torso/waist/spine motion carries.
3. Make sure the shirt's vertex groups are named after the bones (they will be,
   post-transfer) and there are **no stray/renamed groups**.
4. **Verify:** pose `Spine01`, `Waist`, and an `Upperarm` a few degrees — the
   shirt should follow the body cleanly with no tearing, no vertices left behind,
   no poke-through in the rest pose or mild idle poses.

## 3. Naming & material (CRITICAL for the app hook)

- **Name the shirt object/primitive exactly `Shirt`.** This is how the app tells
  it apart from `body` and `FaceSprite` — see the contract below. Get this wrong
  and the app will mis-detect it.
- Give it a **single simple material** (a Principled/Standard material with a
  solid base color — pick any pleasant default, e.g. a soft blue). The app will
  *re-drive* the shirt's final shading to match the active look (SSS/toon/etc.),
  so exact material settings don't matter — but it should have **its own**
  material, NOT share the body's textured material.
- The shirt does **not** need a UV-mapped texture for v1 (solid color). A clean
  UV unwrap is welcome if trivial (leaves room for prints later) but optional.

## 4. Export

- Export **glTF Binary (.glb)**, matching how `yellow_final_v8.glb` was produced:
  +Y up, apply modifiers, include the **armature + body + FaceSprite + Shirt**,
  export skinning/skin weights, keep bone names.
- **Output:** `yellow_final_v9.glb` (next in the
  sequence). Don't overwrite v8.

---

## App-side contract

**What I (the app) will do when v9 lands** — so you know what to guarantee:

- **Identify by name.** Both consumers (`sidekick-canvas.tsx`, `sidekick-3d.tsx`)
  currently split primitives by "has a texture map → body, else → face." I'll
  add a name check *first*: `child.name === "Shirt"` → `shirtMesh`, before the map
  test. → **You must name it exactly `Shirt`.**
- **Shade it in-family.** I'll build the shirt's material from the shared shading
  module (same SSS/toon/physical modes as the body) using its own base color,
  and add a `shirtColor` (and maybe `shirtRoughness`) control to the `/sidekick-3d`
  GUI + settings. → Your material just needs to *exist* and be separate from the
  body's.
- **Outline + interaction.** I'll extend the inverted-hull outline and the
  poke/drag hit-targets to include the shirt.

**What you guarantee back:**
1. Primitive named exactly `Shirt`, separate material.
2. Rig + all 13 bone names unchanged; body & FaceSprite geometry/UVs/texture
   unchanged.
3. Shirt skinned to the same rig (weights transferred from body), offset just
   outside the body, deforms cleanly with no poke-through in rest + mild poses.
4. Same raw scale/orientation as the body; delivered as
   `yellow_final_v9.glb`.

## Acceptance criteria

- v9 GLB loads with **exactly three** skinned primitives: `body` (textured),
  `FaceSprite` (untextured face plane), `Shirt` (solid-color).
- In-engine: posing spine/waist/arms deforms the shirt with the body, no tearing,
  no body poking through at rest or in the idle sway.
- Character still ~0.20 units raw, faces +X, feet at the same origin; body and
  face look identical to v8.

## Out of scope (note for later)

- No cloth simulation, no baked cloth clips.
- Optional future polish: 2–3 spring/jiggle bones on the hem for cheap secondary
  motion; short sleeves; swappable shirt colors/prints as a cosmetic.
