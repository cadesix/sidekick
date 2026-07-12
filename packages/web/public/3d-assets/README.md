# Sidekick 3D character — quick context

Lightweight orientation for working on the 3D mascot. Enough to get started;
deeper mechanics live in the code comments of the `src/components/sidekick-*`
files.

## The character

"Glim" — a chunky, glossy yellow vinyl-toy mascot. Rendered live in three.js
(r185) on two routes:

- **`/sidekick-3d`** — look-dev editor. lil-gui panel to tune shading, pose,
  environment, camera, and the face; writes settings to `localStorage`.
- **`/home3`** — the product home screen; reads the same saved settings so the
  character looks identical to the editor.

## Where the assets are

- **Live mesh (served):** `public/sidekick-rigged.glb` — this is what both
  routes load. Currently a copy of `yellow_final_v5.glb`. The body's color
  texture is **embedded inside the GLB** (no separate image file).
- **Face sprite sheet:** `public/face-sheet.png` — 2048², a 4×4 grid of facial
  expressions, RGBA with a transparent background.
- **Source / working meshes (outside this repo):**
  `~/Desktop/char-pipeline/mesh/` — the Blender + Tripo pipeline output
  (`yellow_final_v*.glb`, plus raw/retopo/rig intermediates). Nothing here is
  served directly; the chosen final gets copied to `public/sidekick-rigged.glb`.

> Cache-busting: the code references the mesh and sheet with a `?v=N` query
> (`MODEL_URL` in `sidekick-shading.ts`, `FACE_SHEET_URL` in `sidekick-face.ts`).
> **Bump `N` every time you replace the file**, or browsers serve a stale copy.

## Mesh facts (what an editing agent needs to know)

- **Orientation:** the model faces **+X** in its raw space. The app rotates the
  rig by `-π/2` so it faces the camera — don't "fix" the export to face −Z.
- **Scale:** raw character is ~0.20 units tall; the app auto-normalizes it to
  1.0 and stands the feet on y=0. Work in whatever scale the pipeline uses.
- **Two primitives:**
  1. **body** — textured (embedded albedo), skinned to the full rig.
  2. **FaceSprite** — a small untextured curved plane on the front of the head,
     skinned 100% to the `Head` bone. The app paints one sprite-sheet cell onto
     it and shifts the UV offset to change expression. It covers a real hole in
     the head, so it must not be deleted or made transparent-with-no-backing.
- **Rig:** humanoid (Tripo/AccuRig-style). Bones the app drives by name:
  `Head`, `Waist`, `Spine01`, `L/R_Upperarm`, `L/R_Forearm`, `L/R_Hand`,
  `L/R_Thigh`, `L/R_Calf`. Keep these names stable across re-exports.
- **No normal map** — bakes were stale/noisy; the app ignores it by design.

## Face sprite sheet

- 4×4 grid, 512² cells, drawn in glTF orientation (row 0 = top of image).
- 12 expressions mapped in `FACE_CELLS` (`sidekick-face.ts`): neutral, blink,
  happy, excited, cheer, sad, sleepy, thinking, surprised, wink, talkOpen,
  talkClosed.
- Background must be **transparent** around the features (the head shows
  through). Features should sit centered with margin so they don't clip the
  FaceSprite plane's edge.

## Consuming code (for reference, not required reading)

`src/components/`: `sidekick-shading.ts` (materials + `MODEL_URL`),
`sidekick-face.ts` (sprite sheet + expression controller + `FACE_SHEET_URL`),
`sidekick-interact.ts` (poke/drag), `sidekick-grass.ts` (environment),
`sidekick-settings.ts` (shared tunables). Routes: `src/sidekick-3d.tsx`,
`src/components/sidekick-canvas.tsx` (home3).

## Open item

The **FaceSprite plane** is a bit short/high, so large face artwork can clip
its edge. The durable fix is re-authoring that plane in Blender (taller, lower,
with UVs that leave a transparent margin around the sprite). See the running
notes in the assistant's memory / chat history for the full spec.
