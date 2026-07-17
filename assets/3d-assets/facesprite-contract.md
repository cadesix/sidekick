# FaceSprite — sprite-sheet mapping contract

Hand-off for wiring the animated face onto the character's `FaceSprite` plane.
Ships on **`public/sidekick-rigged.glb (yellow_final_v9; source blend: tools/char-pipeline/blender/yellow_final_v9.blend)`** (the current
character). The asset side is frozen; this is the exact contract it guarantees and
what you author + implement.

## What the plane is

- A separate **skinned** primitive named **`FaceSprite`** with its **own material**
  (also `FaceSprite`), weighted 100% to the `Head` bone. Detect it as the
  character's untextured face mesh (it has no map in the GLB).
- Geometry: a **circular disc** conformed to the front of the head, offset ~0.8mm
  proud of the head surface, facing **+X** (character front; the app rotates the
  model to face camera). It sits centered on the face, clear of the crown spikes.
- Because the plane is a **disc**, only the disc area renders — anything you map
  toward the cell corners falls off the geometry and is simply not drawn.

## UV layout (authoritative)

The disc is **inscribed in the UV [0,1] square**:
- Disc **center → UV (0.5, 0.5)**; disc **rim → radius 0.5** from center (the rim
  touches [0,1] at the N/S/E/W midpoints). The four UV **corners are off the disc**.
- `u` runs **character-left (+Y) = 0 → character-right (-Y) = 1**.
- `v` runs **bottom (chin) = 0 → top (forehead) = 1**.
- Mapping is near-uniform (disc is circular, aspect ≈1.0) → **no stretch**; a circle
  in UV is a circle on the head.

Practical consequence: **keep all face features inside a centered circle of radius
~0.42** in UV (a little inside the rim, where the disc is flattest — the outer ~15%
curves back and compresses slightly). Corners/edges of each cell won't show.

## Sprite sheet authoring

- **4×4 grid, 16 cells.** Each cell is a **square** 0.25×0.25 of UV. Recommended
  1024² or 2048² sheet (256²/512² per cell).
- Draw each expression **centered in its cell, within the inscribed circle**
  (features clustered central — eyes upper-middle, mouth lower-middle), on a
  **transparent background** (RGBA, straight or premultiplied — state which).
  Where the sprite is transparent, the head shows through, so the face reads as
  drawn-on. Keep a few px transparent gutter at every cell edge to avoid bleed.
- Suggested cell set (index row-major, row 0 = top): neutral, blink-closed,
  happy, sad, surprised, angry, talk-A…D (mouth shapes), wink, etc. You own the
  layout; just publish a small JSON map `{expressionId: [col,row]}` next to the sheet.

## Runtime mapping (three.js)

Load the sheet as one texture:
- `colorSpace = SRGBColorSpace`, `flipY = false`, `premultiplyAlpha` per your PNG,
  `magFilter = Linear`, `generateMipmaps = false` (or a padded atlas if you want mips),
  `wrapS = wrapT = ClampToEdgeWrapping`.
- To show cell `(col, row)`:
  - `texture.repeat.set(0.25, 0.25)`
  - `texture.offset.set(col * 0.25, offsetV)` where `offsetV = (3 - row) * 0.25`
    for **row 0 = top** with `flipY=false`. **Verify orientation** with a test cell
    that has a top marker + a one-eye wink: the marker must sit at the forehead and
    the wink on the correct side. If mirrored horizontally, negate the u mapping
    (`repeat.x = -0.25` with `offset.x = (col+1)*0.25`); if vertically flipped,
    swap the `offsetV` row term.
- Switching expression = set `offset` (and cheap-swap between blink/talk frames on a
  timer). No geometry or material rebuild.

## Material

Build the `FaceSprite` material from the shared shading factory (same SSS/toon/
physical mode as the body) but:
- Base color / albedo = the sheet texture (above); **alpha-blend** (`transparent =
  true`, `alphaTest` ~0.5 if you prefer cutout to avoid sort issues on the disc),
  so transparent cells let the head show through.
- Matte (`roughness ~0.8`, no metal), **no normal map**.
- Keep the untextured base color (head-yellow) as the fallback before the sheet loads.

## Positioning / scaling controls (you already have these)

`createFaceController(faceTex, faceZoom, faceHeight)` in `sidekick-face.ts`:
- **`faceHeight`** — vertical UV offset to nudge the whole face up/down within the
  disc. `0` = centered (features at disc center, head z≈0.137).
- **`faceZoom`** — uniform UV scale about center to grow/shrink the face within the
  disc. `1.0` = the sheet's cell fills the disc. **>1 will clip at the disc rim**
  (the plane is only the disc), so size the art in-sheet and keep zoom ≤ ~1.0.
- Expose both in the `/sidekick-3d` GUI + settings as today; they operate on top of
  the cell offset/repeat.

## Acceptance criteria

- [ ] Each expression cell displays centered on the face, upright, correct-handed
      (wink on the intended side), no mirroring.
- [ ] Transparent areas show the head through; no hard disc edge, no neighbor-cell
      bleed at any expression.
- [ ] Blink and talk loops play by switching `offset` only (no rebuild), returning
      to the base expression cleanly.
- [ ] Face tracks the head on head-turn/pitch (it's skinned to `Head`).
- [ ] `faceHeight`/`faceZoom` reposition/scale the face within the disc with no clip
      at zoom ≤ 1.0.

## Notes
- The disc is intentionally sized to clear the crown spikes; its center sits at the
  face middle. If you need the face lower/bigger, that is an **asset** change
  (`CZ`/`RY`/`RZ` in `char-pipeline/scripts/face_patch_circ.py`) → a new character
  version, not an app fix.
- Cosmetics (shirt/pants/hat/shoes) are independent of the FaceSprite and unaffected.
