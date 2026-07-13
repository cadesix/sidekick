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
