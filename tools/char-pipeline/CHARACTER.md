# The character — facts, rig contract, measurements

The Sidekick mascot ("Glim"): a glossy vinyl-toy yellow bear-like character
with an oversized bobble head, huge round ears, stubby limbs, and a
sprite-sheet-driven face. Shipped mesh: **`packages/web/public/sidekick-rigged.glb`**
(internally `yellow_final_v9`; source blend in `blender/`).

## Provenance (one paragraph of history)

Generated with Tripo (image→model→rig) from hand-drawn **T-pose reference art**
— limbs drawn clear of the body, which is what makes the auto-rig clean; that
was the decisive lesson of the generation project. The raw output was welded,
decimated to ~30k tris, arm sockets re-pivoted, PBR maps stripped (toy look =
baseColor only), and the face region replaced with a conformal "FaceSprite"
disc. v9 = v8 + a larger circular FaceSprite; **the rig and body are unchanged
since v8**, which is why every cosmetic still binds. The full experiment
history lives in the local char-pipeline archive, not this repo.

## Hard invariants (break these and runtime breaks)

- **Raw scale ~0.20 units tall, faces +X, feet at z=0.** The app normalizes the
  character to 1.0 and cosmetics inherit that via the skeleton/bones — never
  pre-scale an asset, never re-normalize it in-app a second time.
- **Canonical bind pose = `blender/character_master.blend`** (frozen copy of the
  v8 rig). Skinned cosmetics exported from any other bind pose will not rebind.
- **13 contract bones** (the app addresses these by name): `Head`, `Waist`,
  `Spine01`, `L/R_Upperarm`, `L/R_Forearm`, `L/R_Hand`, `L/R_Thigh`, `L/R_Calf`.
  The actual armature has 41 bones (Tripo twist chains etc.); deform weights
  often live on twist bones — an empty `L_Upperarm` vgroup is normal, not broken.
- **No foot bones** — feet are rigid relative to the calf (why shoes parent to
  `L/R_Calf`).
- **Max 4 weights per vertex**; two materials on the character (body texture +
  untextured FaceSprite).
- Palms-forward bind: the `R_Hand` bone's local **Z** points out the palm,
  local **Y** runs along the fingers (used by the phone prop).

## FaceSprite (the face plane)

Circular disc conformed to the frontal head cap, joined into the character mesh
as a second primitive with its own material, 100% `Head` weight.
World: center z=0.137, radius 0.043 (top z=0.181 clears the crown tufts at
0.185). UV: the disc is inscribed in [0,1] — disc center = UV(0.5, 0.5), disc
rim touches the UV square's edge midpoints. The app maps a 4×4 sprite sheet via
UV offset/repeat; keep face art inside the inscribed circle. Full app contract:
`packages/web/public/3d-assets/facesprite-contract.md`.
Authoring script: `scripts/face_patch_circ.py` (takes in/out paths via CLI).

## Measurement table (raw units, bind pose — what the build scripts tune against)

| landmark | value |
|---|---|
| head-ball center / radius | `(0.005, 0, 0.148)` / ~0.053 |
| hat rim line (above eyes) | z ≈ 0.155 |
| eye line (face front) | z ≈ 0.150–0.152, front surface x ≈ 0.047 |
| ears | y ±0.055–0.072, z 0.124–0.192 (huge — hats hug the head *between* them) |
| crown tufts/spikes | z 0.185–0.200 (closed hats must cover; open crown lets them poke) |
| neck back | x ≈ −0.034 at z 0.09–0.105 |
| shoulder/wrist (arms out at bind) | forearm y 0.052–0.074, wrist at \|y\| ≈ 0.0766 |
| chest band (z 0.055–0.085) | x −0.023 … +0.015 (back surface ≈ −0.023) |
| waist | z ≈ 0.046–0.054 |
| knee (Thigh→Calf joint) | z ≈ 0.0276 |
| ankle cut for full pants | z ≈ 0.014 (big feet, short legs — higher reads as capris) |
| shoe rim / boot shaft top | z ≈ 0.022 / 0.034 |

## Authoring rules that were learned the hard way

- **Skinned garments**: duplicate the body's surface (inherits exact weights —
  better than Data Transfer), cut with bisect planes, offset outward
  (~0.0026–0.0036), decimate, **boundary snap+relax LAST** (later smoothing
  re-fringes rims), then solidify. See `coslib.py`.
- **Footwear region selection must be geometric** (`dup_geo` position filter),
  not vertex-group dominance — the Foot/Calf/Thigh dominance frontier is patchy
  and leaves jagged rims.
- **Rigid props**: origin at the attach-bone head, `parent_set BONE
  keep_transform`, export **with the armature** so the prop node is a child of
  the bone node. Never append a bone-parented object into another scene
  (parent-inverse is lost) — rebuild it there instead.
- Extra garment parts (hoods, pockets, straps) are closed solids joined in
  after solidify, with explicit bone weights assigned.
- Layering: pants waist offset (0.0026) < shirt offset (0.0034) so shirts layer
  over waistbands without z-fighting.
- **Footwear "de-toe"**: the duplicated foot surface inherits the character's
  toe bumps; normal-looking shoes need `region_smooth` (coslib) — an xy-only
  pass at sole level plus a hard full-axis pass over the foot band, then
  **re-inflate past the foot's bump peaks** (~0.0038) or the toes poke through
  at runtime (the shoe looks lumpy even though its mesh is smooth — render the
  GLB in isolation to tell the two apart). Feather the re-inflate to zero at
  the band top or it leaves a ledge.
- **Cut open rims AFTER decimate** (sneakers/boots shaft tops): decimate re-jags
  a pre-cut boundary into spikes that boundary_finish can't fully relax; a
  bisect after decimate gives a clean straight edge loop.
- **Glasses/eye alignment**: eye world positions depend on the face sheet AND
  the preset's `faceZoom`/`faceHeight` (the prod preset renders features
  higher/wider than the raw doc eye line). Measure from the served sheet under
  the prod preset before placing anything relative to the eyes — see the
  docstring in `scripts/build_glasses.py` for the measured numbers.
- Render-verify from the app's viewing angles and **look at the images**; in
  side views the near ear occludes headwear — that's the ear, not clipping.
- Variant = webp texture into the item's **locked** smart-UV layout (solid
  colors + small all-over patterns survive smart-project islands; directional
  prints don't).
