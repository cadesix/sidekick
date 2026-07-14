"""Sweatband (rigid, hat slot) -> cosmetics/hat/sweatband-v1.glb.
Terry headband hugging the forehead between the ears (rim line z ~0.155,
must stay inside ear inner edge |y| < 0.055).
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()

ob = C.bm_new_obj("Sweatband")
me = ob.data
bm = bmesh.new()
C.add_lathe(bm, [(0.0552, 0.1570, None),
                 (0.0572, 0.1625, None),
                 (0.0570, 0.1685, None),
                 (0.0540, 0.1735, None)], nseg=28, sy=0.90, cx=0.005)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0026, offset=1.0)
C.set_material(ob, "SweatbandMat", (0.80, 0.20, 0.18), 0.95)   # gym red terry
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/sweatband-v1.glb", wip=C.wip("sweatband"))
