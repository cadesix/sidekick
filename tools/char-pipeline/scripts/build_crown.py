"""Crown (rigid, hat slot) -> cosmetics/hat/crown-v1.glb.
Open gold band around the upper head with 8 triangular points; the character's
crown spikes poke out the open top like hair (intended).
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CX = 0.005
BAND_BOT = 0.156; BAND_TOP = 0.172; PEAK = 0.190
RX, RY = 0.0565, 0.0525
NU = 48; NPTS = 8

ob = C.bm_new_obj("Hat")
me = ob.data
bm = bmesh.new()
bot, top = [], []
for i in range(NU):
    u = 2 * math.pi * i / NU
    x = CX + RX * math.cos(u); y = RY * math.sin(u)
    # triangular points: sawtooth over NPTS periods
    ph = (u / (2 * math.pi) * NPTS) % 1.0
    tri = 1.0 - abs(2.0 * ph - 1.0)
    bot.append(bm.verts.new((x, y, BAND_BOT)))
    top.append(bm.verts.new((x, y, BAND_TOP + (PEAK - BAND_TOP) * (tri ** 1.5))))
for i in range(NU):
    bm.faces.new((bot[i], bot[(i + 1) % NU], top[(i + 1) % NU], top[i]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0022, offset=1.0)
C.set_material(ob, "HatMat", (0.85, 0.60, 0.16), 0.35, metallic=0.6)   # gold
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/crown-v1.glb", wip=C.wip("crown"))
