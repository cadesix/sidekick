"""Hoodie (skinned, shirt slot) -> cosmetics/shirt/hoodie-v1.glb.
Long-sleeve shell (torso + full arms to the wrists) + draped hood roll behind
the neck + kangaroo pocket + drawstrings. Same duplicate-body-surface approach
as the tee; extra parts are closed solids joined in with explicit weights.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

HEM_Z = 0.040; CUFF_Y = 0.072; OFFSET = 0.0034

body, rig = C.load_master()
hd = C.dup_region(body, "Shirt", exclude_sub=("Head", "Hand"))   # named Shirt: app detects by slot mesh
C.cut(hd, (0, 0, HEM_Z), (0, 0, 1), clear_inner=True)
C.cut(hd, (0, CUFF_Y, 0), (0, 1, 0), clear_outer=True)
C.cut(hd, (0, -CUFF_Y, 0), (0, 1, 0), clear_inner=True)
C.offset_loosen(hd, OFFSET)
C.decimate(hd, 760)
C.boundary_finish(hd, [("z", HEM_Z), ("absy", CUFF_Y)])
C.solidify(hd, 0.0020)

# --- extra parts (closed solids appended into the mesh, then weighted) ---
me = hd.data
bm = bmesh.new(); bm.from_mesh(me)
n0 = len(bm.verts)

# hood roll: draped tube around the back of the neck (sags at center-back)
path = []
for i in range(13):
    th = math.radians(100 + 160 * i / 12)
    sag = 0.0035 * max(0.0, math.cos(th - math.pi))
    path.append(Vector((0.002 + 0.045 * math.cos(th),
                        0.042 * math.sin(th),
                        0.0955 - sag)))
hood_v = C.add_tube(bm, path, 0.0095, nseg=8)
n1 = len(bm.verts)

# kangaroo pocket: rounded panel on the belly, bent to the torso curve
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
pk = C.add_slab(bm, Vector((0.0225, 0, 0.052)), Y, Z, X, 0.040, 0.017, 0.005, 0.003)
for v in pk:
    v.co.x -= 15.0 * v.co.y * v.co.y          # wrap to belly curvature
n2 = len(bm.verts)

# drawstrings: two short tubes draping down the chest
for sy in (1, -1):
    C.add_tube(bm, [Vector((0.018, sy * 0.0095, 0.088)),
                    Vector((0.019, sy * 0.0095, 0.081)),
                    Vector((0.020, sy * 0.0095, 0.074))], 0.0013, nseg=6)
n3 = len(bm.verts)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free(); me.update()

C.assign_group(hd, list(range(n0, n1)), {"Spine01": 1.0})               # hood
C.assign_group(hd, list(range(n1, n2)), {"Spine01": 0.5, "Waist": 0.5})  # pocket
C.assign_group(hd, list(range(n2, n3)), {"Spine01": 1.0})               # strings

C.set_material(hd, "ShirtMat", (0.45, 0.45, 0.47), 0.85)   # heather gray default
C.smart_uv(hd)
C.finish_weights(hd)
C.export([hd], rig, f"{C.COSDIR}/shirt/hoodie-v1.glb", skinned=True,
         wip=C.wip("hoodie"))
