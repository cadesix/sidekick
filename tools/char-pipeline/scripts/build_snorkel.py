"""Snorkel mask pushed up on the forehead (rigid, glasses slot) ->
cosmetics/glasses/snorkel-v1.glb.
Oval mask above the eyes + strap ring + snorkel tube running up the right
side of the head (-Y). Expressions stay clear.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CX = 0.005; ZC = 0.1745
R_BAND, SY = 0.0545, 0.92

ob = C.bm_new_obj("Snorkel")
me = ob.data
bm = bmesh.new()

# mask: rounded-rect slab proud of the forehead (face front x ~0.047)
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
C.add_slab(bm, Vector((0.0460, 0, ZC)), Y, Z, X, 0.054, 0.024, 0.010, 0.0075,
           scales=(1.0, 0.88))

# strap ring around the head at mask height
NB = 24
rows = []
for z in (ZC - 0.007, ZC + 0.007):
    ring = []
    for i in range(NB):
        a = 0.55 + (2 * math.pi - 1.10) * i / (NB - 1)
        ring.append(bm.verts.new((CX + R_BAND * math.cos(a), SY * R_BAND * math.sin(a), z)))
    rows.append(ring)
for i in range(NB - 1):
    bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))

# snorkel tube up the right side (-Y), open tip above the head
path = [Vector((0.0460, -0.0320, ZC - 0.002)),
        Vector((0.0340, -0.0500, ZC + 0.002)),
        Vector((0.0180, -0.0580, 0.1920)),
        Vector((0.0080, -0.0580, 0.2120)),
        Vector((0.0080, -0.0540, 0.2260))]
C.add_tube(bm, path, radius=0.0042, nseg=8, taper_ends=False, cap=True)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0018, offset=1.0)
C.set_material(ob, "SnorkelMat", (0.15, 0.62, 0.66), 0.35)   # aqua default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/glasses/snorkel-v1.glb", wip=C.wip("snorkel"))
