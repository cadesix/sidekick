# iPhone prop — Blender build spec

A hand-off spec for a **simple phone the character holds and looks down at**
during chat. It is a **rigid cosmetic prop** attached to a hand bone — the same
authoring pattern as the hat (`bone:Head`) and shoes (`bone:Calf`). Read
`cosmetics/CANONICAL-SKELETON.md` and `cosmetics/IMPLEMENTATION-CONTRACT.md`
first; this follows those invariants exactly.

**Scope of THIS task:** the phone *asset* only — a low-poly slab that sits
correctly in the character's hand at bind pose. The **holding pose** (raise the
forearm, curl the hand, pitch the head down to look at the screen) is authored
app-side in code and is NOT baked into this asset. You just need the phone to
ride `R_Hand` believably; I'll rotate the arm + head around it.

---

## Provenance (author against the canonical rig)

- **Source file:** `~/Desktop/char-pipeline/blender/character_master.blend` — the
  canonical rig (copy of shipped `mesh/yellow_final_v8.glb`). Author the phone in
  *this* file so the `R_Hand` bone position/orientation and bind pose are exact.
- **Build like the hat:** mirror `~/Desktop/char-pipeline/scripts/build_hat.py`
  (rigid, origin at the bone attach point, parented to the bone, exported with the
  armature). Add `scripts/build_phone.py`.
- **Do NOT touch** body, FaceSprite, or the rig. Only *add* the phone meshes.

## Character constraints (do NOT change — same as every cosmetic)

- **Orientation:** the character faces **+X** in raw space. Don't reorient the rig.
- **Scale:** raw character is **~0.20 units tall**; the app auto-normalizes the
  whole glTF to **1.0** at runtime and stands feet on `y=0`. Author the phone in
  the **same raw scale** as the body and **do not pre-scale it** — parenting to the
  live (already-normalized) `R_Hand` bone yields the correct final size for free.

---

## 1. Attach point

- **Bone:** `R_Hand` (right hand). *(If a left-hand hold reads better we can mirror
  to `L_Hand` — one-line change; pick whichever grips more naturally at bind pose.)*
- **Pivot/origin:** set the phone object origin to the **grip point** (roughly the
  lower-center/back face of the phone, where the palm meets it), then parent to
  `R_Hand` with that bone-local transform baked in — same as the hat's origin =
  Head attach point. Export so the `Phone` node is a **child of the `R_Hand` node**.
- **Rigid, not skinned.** No armature modifier / no weights on the phone; it's a
  child of the bone node (the app re-parents it to the live `R_Hand` bone).

## 2. Model (keep it very simple)

- A **rounded-rectangle slab**: rounded corners, thin depth, a slightly **inset
  screen** on the front face. That's it — no buttons/ports needed. A tiny flush
  camera bump is optional flavor.
- **Target size (in runtime-normalized units, character = 1.0 tall):**
  - long axis (height) ≈ **0.15** (acceptable 0.13–0.18)
  - width ≈ **0.07**, thickness ≈ **0.012**
  - → in **raw** authoring units (×0.20): height ≈ **0.030u**, width ≈ 0.014u,
    thickness ≈ 0.0024u. **Author at raw scale; verify visually** — it should fill
    the palm and read clearly as a phone when he looks down at it, not tiny, not
    comically huge.
- **Poly budget:** ≤ ~350 tris (the hat is 520; this is simpler). Quads preferred.
- **Screen orientation:** the screen's outward normal should face the **palm side**
  (the side the fingers curl toward) so that when the app raises the arm and pitches
  the head down, the screen faces his eyes. Long axis roughly aligned with the
  hand/fingers. I'll fine-tune the hold in code and may ask for a small tweak to the
  baked local transform.

## 3. Naming & materials (CRITICAL for the app hook)

Two meshes, two own materials (mirrors the shoes' two-mesh rigid convention, but
both route to the **same** bone):

| mesh          | material      | notes                                            |
|---------------|---------------|--------------------------------------------------|
| `Phone`       | `PhoneBody`   | dark matte frame/back (e.g. `#1c1c1e`)           |
| `PhoneScreen` | `PhoneScreen` | front glass; keep it a **separate** material so the app can later drive it emissive / map live content. Inset ~0.5–1% to avoid z-fight. |

- **Own materials**, never the body's textured material. **No normal map.**
- Solid base colors are fine (the app re-drives shading to match the active
  look-dev mode). A trivial UV unwrap on `PhoneScreen` is welcome (leaves room to
  map a screenshot/emissive later) but optional.

## 4. Export

- **glTF Binary (.glb)**, matching how the other cosmetics were produced: **+Y up**,
  apply modifiers/transforms, include **`Phone` + `PhoneScreen` + the armature**
  (so both phone nodes are children of the `R_Hand` node with correct bone-local
  transforms). No skinning on the phone. Keep bone names byte-identical.
- **Output:** `public/cosmetics/phone/base-v1.glb` (i.e.
  `~/Desktop/char-pipeline/.../cosmetics/phone/base-v1.glb`).

## 5. Manifest entry (add to `cosmetics/manifest.json`)

```jsonc
"phone": {
  "model": "/cosmetics/phone/base-v1.glb",
  "attach": "bone:R_Hand",
  "meshes": { "Phone": "R_Hand", "PhoneScreen": "R_Hand" },
  "variants": [ { "id": "default", "name": "Phone" } ]
}
```

No texture variants needed (single prop). This plugs into the existing
`CosmeticsController` as a rigid slot with no new runtime code — `equip("phone")`
attaches it, same as the hat.

---

## What the app guarantees back (so you know the division of labor)

- The app poses the **arm (`R_Upperarm`/`R_Forearm`/`R_Hand`)** and **head** in
  code to raise the phone and look down at it while in chat, then freezes idle;
  and equips/unequips `phone` on entering/leaving chat.
- The app re-drives `PhoneBody`/`PhoneScreen` through the shared shading factory
  (SSS/toon/cel/etc.) to match the current look, and may later map a live
  emissive texture onto `PhoneScreen`.

## Acceptance checklist

- [ ] `equip("phone")` → phone appears in `R_Hand`, correct size/orientation, no
      z-fight between frame and screen, no clipping through the fingers at bind pose.
- [ ] Posing `R_Forearm`/`R_Hand` → the phone follows rigidly (it's a child of the
      bone), stays gripped.
- [ ] Two separate materials survive import (`PhoneBody`, `PhoneScreen`); screen is
      a distinct primitive.
- [ ] Character still ~0.20u raw / **1.0 on screen**, faces +X, feet at origin;
      body + FaceSprite unchanged.
- [ ] Delivered as `cosmetics/phone/base-v1.glb` + manifest `phone` entry.

## Out of scope (later)

- Live/emissive screen content (screenshot of the chat) — the separate
  `PhoneScreen` material is the hook for it.
- The holding pose + look-down (app-side code).
