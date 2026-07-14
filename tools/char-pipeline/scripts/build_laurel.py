"""Laurel wreath (rigid, hat slot) -> cosmetics/hat/laurel-v1.glb.
Ring of leaves around the upper head, open at the front (forehead shows,
crown tufts poke out the open top — intended, like the crown). Streak-reward
energy. Stays inside the ears (|y| < 0.055).
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CX = 0.005; Z0 = 0.1655; RX, SY = 0.0545, 0.92

ob = C.bm_new_obj("Laurel")
me = ob.data
bm = bmesh.new()

# stem: open arc tube (gap at the front, +X)
path = []
for i in range(21):
    u = math.radians(-145 + 290 * i / 20)   # gap at the BACK — leaves sweep across the brow
    path.append(Vector((CX + RX * math.cos(u), SY * RX * math.sin(u), Z0)))
C.add_tube(bm, path, radius=0.0028, nseg=6, taper_ends=True, cap=True)

# leaves: flattened ellipsoids lying along the stem, alternating up/down
NL = 16
for k in range(NL):
    u = math.radians(-135 + 270 * k / (NL - 1))
    p = Vector((CX + RX * math.cos(u), SY * RX * math.sin(u), Z0))
    tang = Vector((-math.sin(u), SY * math.cos(u), 0)).normalized()
    rad = Vector((math.cos(u), SY * math.sin(u), 0)).normalized()
    up = Vector((0, 0, 1))
    tilt = (up + rad * 0.35).normalized()
    off = tilt * (0.0055 if k % 2 == 0 else 0.0028) + tang * 0.002 + rad * 0.0058
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in ret["verts"]:
        v.co = p + off + tang * (v.co.x * 0.0135) + tilt * (v.co.y * 0.0068) + rad * (v.co.z * 0.0038)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "LaurelMat", (0.83, 0.55, 0.10), 0.3, metallic=0.45)   # gold default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/laurel-v1.glb", wip=C.wip("laurel"))
