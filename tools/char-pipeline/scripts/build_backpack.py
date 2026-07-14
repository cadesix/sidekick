"""Mini backpack (rigid, NEW `back` slot -> Spine01 bone) -> cosmetics/back/backpack-v1.glb.
Rounded tapered box snug on the back + front pocket + top handle loop.
Back surface measured at x~-0.023 (chest band z 0.055-0.085).
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

ob = C.bm_new_obj("Backpack")
me = ob.data
bm = bmesh.new()
# main body: rounded slab from just off the back, tapering slightly to the rear
C.add_slab(bm, Vector((-0.0245, 0, 0.062)), Y, Z, -X, 0.052, 0.042, 0.011, 0.026,
           scales=(1.0, 0.90))
# front (outward-facing) pocket
C.add_slab(bm, Vector((-0.0505, 0, 0.054)), Y, Z, -X, 0.030, 0.018, 0.006, 0.0055,
           scales=(1.0, 0.85))
# top handle loop
path = [Vector((-0.037, -0.009 + 0.018 * i / 7,
                0.0835 + 0.0055 * math.sin(math.pi * i / 7))) for i in range(8)]
C.add_tube(bm, path, 0.0018, nseg=6, taper_ends=False)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "BackpackMat", (0.62, 0.14, 0.12), 0.7)   # red default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Spine01")
C.export([ob], rig, f"{C.COSDIR}/back/backpack-v1.glb", wip=C.wip("backpack"))
