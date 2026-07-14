"""Ski goggles pushed up on the forehead (rigid, glasses slot) ->
cosmetics/glasses/goggles-v1.glb.
Curved visor band above the eyes (z ~0.165-0.184, so expressions stay clear)
+ strap ring around the head. Stays inside the ears (|y| < 0.055).
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CX = 0.005; Z0, Z1 = 0.1635, 0.1855
R_BAND, SY = 0.0545, 0.92

ob = C.bm_new_obj("Goggles")
me = ob.data
bm = bmesh.new()

# visor: curved slab following the head over the front arc, bulging forward
NA, NZ = 16, 3
A0 = 0.85   # arc half-angle (rad) — ends before the ears
rows = []
for zi in range(NZ):
    z = Z0 + (Z1 - Z0) * zi / (NZ - 1)
    dome = 1.0 - 0.35 * abs(2 * zi / (NZ - 1) - 1.0)     # rounder profile
    ring = []
    for i in range(NA):
        a = -A0 + 2 * A0 * i / (NA - 1)
        bulge = 0.0115 * math.cos(a * (math.pi / 2) / A0) * dome
        rr = R_BAND + 0.0015 + bulge
        ring.append(bm.verts.new((CX + rr * math.cos(a), SY * rr * math.sin(a), z)))
    rows.append(ring)
for a, b in zip(rows, rows[1:]):
    for i in range(NA - 1):
        bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))

# strap: thin band completing the ring behind the visor
NB = 20
rows = []
for z in (Z0 + 0.004, Z1 - 0.004):
    ring = []
    for i in range(NB):
        a = A0 - 0.1 + (2 * math.pi - 2 * (A0 - 0.1)) * i / (NB - 1)
        ring.append(bm.verts.new((CX + R_BAND * math.cos(a), SY * R_BAND * math.sin(a), z)))
    rows.append(ring)
for i in range(NB - 1):
    bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0022, offset=1.0)
C.set_material(ob, "GogglesMat", (0.25, 0.45, 0.88), 0.3)   # alpine blue default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/glasses/goggles-v1.glb", wip=C.wip("goggles"))
