"""Wizard hat (rigid, hat slot) -> cosmetics/hat/wizard-v1.glb.
Tall concave cone with a back-leaning tip + circular brim.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CX = 0.005; BASE_Z = 0.157

ob = C.bm_new_obj("Hat")
me = ob.data
bm = bmesh.new()
# brim: flat ring with a slight droop at the outer edge
C.add_lathe(bm, [(0.078, BASE_Z - 0.005, None),
                 (0.064, BASE_Z - 0.001, None),
                 (0.048, BASE_Z, None)], nseg=24, sy=0.94, cx=CX)
# cone: concave profile, tip leaning back (-X)
rings = []
NR = 8
for i in range(NR):
    t = i / (NR - 1)
    r = 0.049 * (1.0 - t) ** 1.3 + 0.0015 * (1 - t)
    z = BASE_Z + 0.100 * t
    cx = CX - 0.014 * t * t          # lean back
    rings.append((max(r, 0.002), z, cx))
C.add_lathe(bm, rings, nseg=20, sy=0.94, cx=CX, close_top=True)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0022, offset=1.0)
C.set_material(ob, "HatMat", (0.28, 0.16, 0.45), 0.8)   # wizard purple default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/wizard-v1.glb", wip=C.wip("wizard"))
