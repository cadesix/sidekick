# Shop drop — 10 new items (addendum to IMPLEMENTATION-CONTRACT.md)

All items follow the frozen authoring contract (canonical rig
`character_master.blend`, raw ~0.20u scale, +X facing, one material per mesh,
smart-UV locked per base). Build scripts live in
`tools/char-pipeline/scripts/build_<item>.py` (shared lib `coslib.py`).

## Manifest schema addition: `slot`

New entries are keyed by **item id** and carry a `"slot"` field. Items with the
same slot are **mutually exclusive** — equipping one unequips the other (e.g.
equipping `beanie` removes `hat`/`bucket`/`wizard`/`crown`). Entries without a
`slot` field (the original five) implicitly use their key as their slot. Nothing
else changes: `attach`, `variants`, `meshes`, and the per-item `scale`/`offset`
tuning knobs behave exactly as they already do.

## The items

| item     | slot    | attach       | meshes             | notes |
|----------|---------|--------------|--------------------|-------|
| hoodie   | shirt   | skinned      | `Shirt`            | long sleeves to the wrists, hood roll (weighted `Spine01`), kangaroo pocket, drawstrings |
| shorts   | pants   | skinned      | `Pants`            | hem above the knee (z 0.030 raw) |
| beanie   | hat     | bone:Head    | `Hat`              | dome + rolled cuff; cuff sits at brow, clears the eye line |
| bucket   | hat     | bone:Head    | `Hat`              | 360° flared brim; brim tucks against the ear roots (intended) |
| wizard   | hat     | bone:Head    | `Hat`              | tall back-leaning cone + brim |
| crown    | hat     | bone:Head    | `Hat`              | OPEN top — the head tufts poke through on purpose; gold/silver via texture + roughness |
| sneakers | shoes   | bone:Calf    | `Shoe_L`/`Shoe_R`  | chunky flared flat sole |
| boots    | shoes   | bone:Calf    | `Shoe_L`/`Shoe_R`  | shaft to mid-calf (z 0.034 raw) |
| glasses  | glasses | bone:Head    | `Glasses`          | NEW slot; round lenses over the FaceSprite eye line, temples curve to the ears |
| backpack | back    | bone:Spine01 | `Backpack`         | NEW slot; mini pack + pocket + top handle. No straps (arm-swing clip risk) |

## Notes for the controller

- **Two new slots** (`glasses` → Head, `back` → Spine01) reuse the existing
  rigid re-parent path — no new code beyond accepting the slot names.
- The four new hats copy the hat slot's tuned `scale: 0.76` /
  `offset: [0, 0.028, 0]` as a starting point (same head, same authoring).
  Tune per-item if any sits off.
- Skinned items (`hoodie`, `shorts`) keep the slot mesh names `Shirt`/`Pants`
  so the existing rebind hook works unchanged.
- Sneakers/boots reuse the shoes' two-mesh convention (`Shoe_L`→`L_Calf`,
  `Shoe_R`→`R_Calf`, one shared material).
- All variants are 256² webp; crown + glasses lean on per-variant `roughness`.

# Accessory drop — 14 new items

Same frozen contract. All rigid single-mesh items, authored TRUE-SIZE against
the master rig — **no manifest `scale`/`offset`** (the old hats' 0.76/0.028 is
legacy for their shared base; new items must not copy it). All variants are
**color-only** (`color` + optional `roughness`/`metalness`, no textures).

| item       | slot    | attach       | notes |
|------------|---------|--------------|-------|
| headphones | hat     | bone:Head    | band arcs over the crown between the tufts and the ears |
| earmuffs   | hat     | bone:Head    | fluffy pads centered on the ear balls, thin over-head band |
| sweatband  | hat     | bone:Head    | lathe ring at brow (z 0.157–0.174 raw) — above eyes, below tufts |
| laurel     | hat     | bone:Head    | leaf ring sweeps ACROSS the brow, gap at the back (front gap reads invisible — the big ears hide the sides) |
| propeller  | hat     | bone:Head    | skullcap + stem + 4 pitched blades above the tufts |
| catbeanie  | hat     | bone:Head    | beanie dome + two cat-ear cones |
| cowboy     | hat     | bone:Head    | parametric curled brim + creased crown |
| stars      | glasses | bone:Head    | star lenses centered on measured eyes (±0.0223, z 0.1505); flat-shaded on purpose |
| goggles    | glasses | bone:Head    | visor pushed up on the forehead (z 0.164–0.186) so expressions stay clear |
| snorkel    | glasses | bone:Head    | mask up on forehead + tube up the −Y side |
| earring    | ear     | bone:Head    | NEW slot; hoop pierces the ear-ball's lower lobe (measured: ear x −0.023..0.013, bottom z ≈0.1355 at y 0.056) |
| flower     | ear     | bone:Head    | tucked at the ear root |
| earbow     | ear     | bone:Head    | small bow on the −Y ear |
| scarf      | neck    | bone:Spine01 | NEW slot; parented to Spine01 (neck-adjacent, moves with the torso), ring + chest tail |

Controller notes: two more region-only slots (`ear`, `neck`) — rigid re-parent
path, no new code. Wardrobe regions: the 7 hats join the hat region, the 3
glasses-family items join the glasses region, `ear` items and `scarf` get their
own regions (they layer with everything else).
