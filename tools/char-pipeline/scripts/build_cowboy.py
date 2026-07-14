"""Cowboy hat (rigid, hat slot) -> cosmetics/hat/cowboy-v1.glb.
Wide brim curled up at the sides + creased crown dome covering the tufts.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CX = 0.005; BASE_Z = 0.157; SY = 0.94

ob = C.bm_new_obj("Cowboy")
me = ob.data
bm = bmesh.new()

# brim: radial grid, z curls up at the sides (|sin u|), flat front/back
NU, NT = 36, 4
R_IN, R_OUT = 0.046, 0.082
rows = []
for ti in range(NT):
    t = ti / (NT - 1)
    rr = R_IN + (R_OUT - R_IN) * t
    ring = []
    for i in range(NU):
        u = 2 * math.pi * i / NU
        curl = 0.020 * (abs(math.sin(u)) ** 1.6) * (t ** 2)
        droop = -0.004 * t * (math.cos(u) ** 2)          # slight droop front/back
        ring.append(bm.verts.new((CX + rr * math.cos(u), SY * rr * math.sin(u),
                                  BASE_Z + curl + droop)))
    rows.append(ring)
for a, b in zip(rows, rows[1:]):
    for i in range(NU):
        bm.faces.new((a[i], a[(i + 1) % NU], b[(i + 1) % NU], b[i]))

# crown: dome with a center crease along x
ret = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.054)
crown = ret["verts"]
for v in crown:
    v.co = Vector((v.co.x * 1.00, v.co.y * 0.90, v.co.z * 1.00)) + Vector((CX, 0, 0.150))
doomed = [v for v in crown if v.co.z < BASE_Z - 0.002]
bmesh.ops.delete(bm, geom=doomed, context="VERTS")
for v in bm.verts:
    if v.co.z > 0.188 and abs(v.co.y) < 0.014:
        v.co.z -= 0.0075 * (1.0 - abs(v.co.y) / 0.014)   # crease

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0024, offset=1.0)
C.set_material(ob, "CowboyMat", (0.62, 0.44, 0.24), 0.8)   # tan felt default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/cowboy-v1.glb", wip=C.wip("cowboy"))
