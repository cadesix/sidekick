"""Daily loot chest — a WORLD PROP, not a cosmetic: it sits on the ground next
to the character (daily box faucet, docs/token-economy.md). No rig, no skin.
Output: packages/web/public/props/lootbox-v1.glb

Meshes split two ways: by material so the web runtime can retint per box tier
(base/silver/gold) by material name, and lid-vs-body so the lid can hinge open
at runtime. The two Lid* objects have their ORIGIN ON THE HINGE LINE (back
seam), so the runtime opens the chest by rotating those nodes about local X:
  LootBody     / Chest_Body    the chest body (tub)
  LootLid      / Chest_Body    the domed lid — origin at the back-seam hinge
  LootLidStrap / Chest_Trim    the strap arc over the dome — same hinge origin
  LootTrim     / Chest_Trim    strap strips down the body front/back
  LootEmblem   / Chest_Emblem  the latch disc on the body front

Run:  /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/char-pipeline/scripts/build_lootbox.py

Authored z-up (Blender), 1.0 unit wide, sitting on z=0; export_yup flips it.
The web loads it at ~0.32 scale so it stands about knee-high on the character.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import coslib as C

OUT = os.path.join(C.REPO, "packages", "web", "public", "props", "lootbox-v1.glb")

# ---------------- proportions ----------------
W = 1.00          # body width (x)
D = 0.78          # body depth (y)
BODY_Z0, BODY_Z1 = 0.0, 0.50
LID_RY, LID_RZ = D / 2, 0.30   # elliptical dome: y half-depth, z rise
STRAP_W = 0.15    # strap width along x
STRAP_T = 0.022   # strap sticks out this far past the surface
EMBLEM_R = 0.135
NSEG = 22         # arc segments for the dome


def new_obj(name):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def fill_grid(bm, rows, cap_centers=None):
    """Quad-strip consecutive vert rows; optionally fan-cap the first/last row
    to explicit center points (so a half-arc's end cap lies flat on the seam
    plane instead of bulging to the row centroid)."""
    for a, b in zip(rows, rows[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    if cap_centers:
        for row, center, flip in ((rows[0], cap_centers[0], False), (rows[-1], cap_centers[1], True)):
            vc = bm.verts.new(center)
            for i in range(len(row) - 1):
                tri = (row[i], row[i + 1], vc)
                bm.faces.new(tri if flip else tuple(reversed(tri)))


def half_barrel(bm, x0, x1, ry, rz, z0, arc0=0.0, arc1=math.pi, nseg=NSEG):
    """Dome lid surface: elliptical arc in (y,z) swept along x, end caps fanned
    flat from the seam-plane center of each end. Returns rows."""
    rows = []
    for x in (x0, x1):
        row = [
            bm.verts.new((x, ry * math.cos(arc0 + (arc1 - arc0) * i / nseg),
                          z0 + rz * math.sin(arc0 + (arc1 - arc0) * i / nseg)))
            for i in range(nseg + 1)
        ]
        rows.append(row)
    fill_grid(bm, rows, cap_centers=((x0, 0, z0), (x1, 0, z0)))
    return rows


def box(bm, x0, x1, y0, y1, z0, z1):
    v = [bm.verts.new(p) for p in (
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    idx = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7))
    for f in idx:
        bm.faces.new([v[i] for i in f])


def disc(bm, cy, cz, r, y_out, nseg=20):
    """Latch disc facing -y (the chest front): a short cylinder + cap."""
    rows = []
    for y in (cy, cy - y_out):
        rows.append([bm.verts.new((r * math.cos(2 * math.pi * i / nseg), y,
                                   cz + r * math.sin(2 * math.pi * i / nseg)))
                     for i in range(nseg)])
    for a, b in zip(rows, rows[1:]):
        for i in range(nseg):
            bm.faces.new((a[i], a[(i + 1) % nseg], b[(i + 1) % nseg], b[i]))
    c = bm.verts.new((0, cy - y_out, cz))
    front = rows[-1]
    for i in range(nseg):
        bm.faces.new((front[(i + 1) % nseg], front[i], c))


def finish(ob, smooth):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth


# the lid hinge: back seam of the body, where the dome meets the tub
HINGE = Vector((0, D / 2, BODY_Z1))


def set_hinge_origin(ob):
    """Move the object's origin to the hinge line so runtime rotation.x opens it."""
    ob.data.transform(Matrix.Translation(-HINGE))
    ob.location = HINGE


# ---------------- build ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)

# body tub (topless — the lid dome is its own hinged object)
body = new_obj("LootBody")
bm = bmesh.new()
# body: rounded-rect slab, slightly narrower at the base (chest taper)
C.add_slab(bm, Vector((0, 0, BODY_Z0)), Vector((1, 0, 0)), Vector((0, 1, 0)),
           Vector((0, 0, 1)), W, D, 0.10, BODY_Z1 - BODY_Z0, scales=(0.92, 1.0))
bm.to_mesh(body.data)
bm.free()
finish(body, smooth=True)
C.set_material(body, "Chest_Body", (1.0, 0.72, 0.23), 0.85)

# domed lid — separate object, origin on the hinge
lid = new_obj("LootLid")
bm = bmesh.new()
half_barrel(bm, -W / 2, W / 2, LID_RY, LID_RZ, BODY_Z1)
# close the lid's open underside (visible once the chest opens)
u0 = [bm.verts.new((-W / 2, -LID_RY, BODY_Z1)), bm.verts.new((W / 2, -LID_RY, BODY_Z1)),
      bm.verts.new((W / 2, LID_RY, BODY_Z1)), bm.verts.new((-W / 2, LID_RY, BODY_Z1))]
bm.faces.new(u0)
bm.to_mesh(lid.data)
bm.free()
finish(lid, smooth=True)
C.set_material(lid, "Chest_Lid", (1.0, 0.72, 0.23), 0.85)
set_hinge_origin(lid)

# strap arc over the dome — rides the lid, same hinge origin
lidstrap = new_obj("LootLidStrap")
bm = bmesh.new()
half_barrel(bm, -STRAP_W / 2, STRAP_W / 2, LID_RY + STRAP_T, LID_RZ + STRAP_T, BODY_Z1)
bm.to_mesh(lidstrap.data)
bm.free()
finish(lidstrap, smooth=False)
C.set_material(lidstrap, "Chest_Trim", (1.0, 0.28, 0.24), 0.8)
set_hinge_origin(lidstrap)

# strap strips down the body front/back (stay with the tub)
trim = new_obj("LootTrim")
bm = bmesh.new()
box(bm, -STRAP_W / 2, STRAP_W / 2, -D / 2 - STRAP_T, -D / 2 + 0.02, 0.02, BODY_Z1)
box(bm, -STRAP_W / 2, STRAP_W / 2, D / 2 - 0.02, D / 2 + STRAP_T, 0.02, BODY_Z1)
bm.to_mesh(trim.data)
bm.free()
finish(trim, smooth=False)
C.set_material(trim, "Chest_Trim", (1.0, 0.28, 0.24), 0.8)

# latch disc on the front, sitting on the body/lid seam under the strap
emblem = new_obj("LootEmblem")
bm = bmesh.new()
disc(bm, -D / 2 - STRAP_T + 0.004, BODY_Z1 - 0.02, EMBLEM_R, 0.05)
bm.to_mesh(emblem.data)
bm.free()
finish(emblem, smooth=True)
C.set_material(emblem, "Chest_Emblem", (1.0, 0.95, 0.84), 0.6)

# ---------------- export (props are rig-free; coslib.export wants a rig) ----------------
objs = [body, lid, lidstrap, trim, emblem]
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True)
for o in objs:
    o.data.calc_loop_triangles()
    print(f"{o.name}: {len(o.data.vertices)} verts, {len(o.data.loop_triangles)} tris")
print("exported", OUT)
