"""Gold hoop earring (rigid, NEW ear slot) -> cosmetics/ear/earring-v1.glb.
Single hoop hanging off the bottom of the character-left ear (+Y).
Ear: y 0.055..0.072, z 0.124..0.192.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
Y0, Z0, CX = 0.0600, 0.1315, 0.0000   # measured: ear ball x -0.023..0.013, bottom z ~0.1355 at y 0.056
R, r = 0.0075, 0.0016
NU, NV = 20, 8

ob = C.bm_new_obj("Earring")
me = ob.data
bm = bmesh.new()
rows = []
for j in range(NV):
    a = 2 * math.pi * j / NV
    ring = []
    for i in range(NU):
        u = 2 * math.pi * i / NU
        rr = R + r * math.cos(a)
        # torus in the x-z plane (axis along y) so it reads as a hanging hoop
        ring.append(bm.verts.new((CX + rr * math.cos(u), Y0 + r * math.sin(a), Z0 + rr * math.sin(u))))
    rows.append(ring)
for j in range(NV):
    a, b = rows[j], rows[(j + 1) % NV]
    for i in range(NU):
        bm.faces.new((a[i], a[(i + 1) % NU], b[(i + 1) % NU], b[i]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "EarringMat", (0.87, 0.65, 0.20), 0.25, metallic=0.85)   # gold
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/ear/earring-v1.glb", wip=C.wip("earring"))
