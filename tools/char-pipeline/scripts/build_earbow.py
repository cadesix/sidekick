"""Bow on one ear (rigid, NEW ear slot) -> cosmetics/ear/earbow-v1.glb.
Two lobes + knot perched on top of the character-right ear (-Y).
Ear top z ~0.192.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
K = Vector((0.005, -0.0630, 0.1870))          # knot: top of the right ear
TILT = Vector((0.0, -0.28, 0.96)).normalized()  # ear leans slightly outward

ob = C.bm_new_obj("Earbow")
me = ob.data
bm = bmesh.new()

side = Vector((0, 1, 0))
out = TILT
fwd = side.cross(out).normalized()
# lobes: squashed spheres spreading along the ear-top tangent (y)
for sgn in (1, -1):
    ctr = K + side * (sgn * 0.0110) + out * 0.0022
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in ret["verts"]:
        v.co = ctr + side * (v.co.y * 0.0105) + fwd * (v.co.x * 0.0068) + out * (v.co.z * 0.0050)
# knot
ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
for v in ret["verts"]:
    v.co = K + side * (v.co.y * 0.0044) + fwd * (v.co.x * 0.0044) + out * (v.co.z * 0.0040 + 0.0022)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "EarbowMat", (0.78, 0.16, 0.22), 0.55)   # red ribbon default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/ear/earbow-v1.glb", wip=C.wip("earbow"))
