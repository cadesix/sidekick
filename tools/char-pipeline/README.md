# char-pipeline — cosmetic & character authoring tools

Headless-Blender pipeline that authors the character's cosmetic items (GLBs in
`packages/web/public/cosmetics/`) against the canonical rig. Read
**`CHARACTER.md`** (in this directory) for who the character is, the rig
contract, and the measurement table every script here is tuned against.

This is the *authoring* pipeline only. The character *generation* lab (Tripo /
Hunyuan experiments, retopo/rig runs, old meshes and renders, ~900MB) is a
local archive outside this repo.

## Prerequisites

- Blender 4.4 (`/Applications/Blender.app` on macOS). No other deps — scripts
  use only Blender's bundled Python (bpy/bmesh/numpy).
- All scripts are path-independent (they locate the repo from their own
  location); run them from anywhere.

## Layout

```
blender/character_master.blend   canonical rig — frozen bind-pose source of truth.
                                 Every cosmetic is authored against THIS file.
                                 Do not modify it; a changed bind pose silently
                                 breaks runtime rebinding for every skinned item.
blender/yellow_final_v9.blend    source of the shipped character
                                 (== packages/web/public/sidekick-rigged.glb)
scripts/coslib.py                shared authoring lib (garment + rigid patterns)
scripts/build_<item>.py          one script per item, output committed under
                                 packages/web/public/cosmetics/<slot>/
scripts/render_shop.py           render any/all items on the character for review
scripts/render_cap.py|phone.py   per-item render helpers
scripts/gen_shop_textures.py     variant webp textures (Blender image API, no PIL)
scripts/pose_verify.py           rig contract checker (12 checks + stress poses)
scripts/face_patch_circ.py       FaceSprite disc authoring (character, not cosmetics)
.wip/, renders/                  local outputs, gitignored
```

## Commands

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender

# (re)build one item — writes packages/web/public/cosmetics/<slot>/<item>.glb
$B --background --python tools/char-pipeline/scripts/build_hat.py

# regenerate all variant textures
$B --background --python tools/char-pipeline/scripts/gen_shop_textures.py

# render items on the character for visual review (all, or a subset)
$B --background --python tools/char-pipeline/scripts/render_shop.py
ONLY=beanie,boots $B --background --python tools/char-pipeline/scripts/render_shop.py
# -> tools/char-pipeline/renders/shop/<item>_<view>.png

# verify the rig contract on a character blend
$B --background --python tools/char-pipeline/scripts/pose_verify.py -- \
   tools/char-pipeline/blender/yellow_final_v9.blend /tmp/pose_renders
```

## Adding a new item

1. Read `CHARACTER.md` for measurements + authoring rules; pick the nearest
   existing `build_*.py` as the template (skinned garment → `build_hoodie.py`;
   rigid head prop → `build_beanie.py`; footwear → `build_sneakers.py`;
   bone prop → `build_phone.py`).
2. Build + export, then render it on the character (`render_shop.py`) and
   **look at the images** before shipping.
3. Register it in `packages/web/public/cosmetics/manifest.json` (see
   `SHOP-NOTES.md` there for the `slot` field semantics) and add variant
   textures via `gen_shop_textures.py`.
4. Refresh the Shop's static product PNGs (`public/shop-renders/`) by running
   the app's `/item-render` route. With the web dev server on :3100 this works
   headlessly (real GPU; do NOT pass --disable-gpu or --virtual-time-budget —
   both stall WebGL; macOS has no `timeout`, hence the perl alarm):

   ```bash
   perl -e 'alarm shift; exec @ARGV' 120 \
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless=new --no-first-run --enable-unsafe-swiftshader \
     --user-data-dir=/tmp/chrome-itemrender \
     "http://localhost:3100/item-render?slots=<item1>,<item2>"
   ```

Runtime/app-side contracts live next to the assets:
`packages/web/public/cosmetics/{CANONICAL-SKELETON.md, IMPLEMENTATION-CONTRACT.md, SHOP-NOTES.md}`.
