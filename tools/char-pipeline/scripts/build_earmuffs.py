"""Earmuffs (rigid, hat slot) -> cosmetics/hat/earmuffs-v1.glb.
Fluffy pads over the ears + a thin band over the crown. Like headphones but
rounder pads and a skinnier band.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148))

ob = C.bm_new_obj("Earmuffs")
me = ob.data
bm = bmesh.new()

# pads: plush balls over the ear centers
for sgn in (1, -1):
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.0235)
    for v in ret["verts"]:
        v.co = Vector((v.co.x, v.co.y * 0.62, v.co.z * 1.05)) + Vector((0.005, sgn * 0.076, 0.159))

# thin band over the top
path = []
for i in range(13):
    a = math.radians(-70 + 140 * i / 12)
    path.append(CEN + Vector((0, math.sin(a) * 0.070, math.cos(a) * 0.0715)))
C.add_tube(bm, path, radius=0.0026, nseg=8, taper_ends=False, cap=True)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "EarmuffsMat", (0.94, 0.92, 0.93), 1.0)   # snow-white plush
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/earmuffs-v1.glb", wip=C.wip("earmuffs"))
