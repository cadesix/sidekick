"""Scarf (rigid, NEW neck slot -> Spine01) -> cosmetics/neck/scarf-v1.glb.
Chunky wrapped ring around the neck (z ~0.09-0.105) + a short stiff tail
hanging down the chest front. No cloth sim — everything is rigid.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
NC = Vector((-0.001, 0.0, 0.1060))   # neck center (back x ~-0.034, chest front ~0.015)

ob = C.bm_new_obj("Scarf")
me = ob.data
bm = bmesh.new()

# wrap: squashed torus around the neck
NU, NV = 24, 10
R, r = 0.0345, 0.0125
rows = []
for j in range(NV):
    a = 2 * math.pi * j / NV
    ring = []
    for i in range(NU):
        u = 2 * math.pi * i / NU
        rr = R + r * math.cos(a)
        ring.append(bm.verts.new((NC.x + rr * math.cos(u), 0.96 * rr * math.sin(u),
                                  NC.z + 0.80 * r * math.sin(a))))
    rows.append(ring)
for j in range(NV):
    a, b = rows[j], rows[(j + 1) % NV]
    for i in range(NU):
        bm.faces.new((a[i], a[(i + 1) % NU], b[(i + 1) % NU], b[i]))

# tail: tapered slab hanging down the chest front, slightly off-center
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
C.add_slab(bm, Vector((0.0300, 0.0125, 0.1010)), Y, X, -Z, 0.0195, 0.0070, 0.003, 0.0380,
           scales=(1.0, 0.80))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "ScarfMat", (0.72, 0.18, 0.20), 0.95)   # cranberry knit default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Spine01")
C.export([ob], rig, f"{C.COSDIR}/neck/scarf-v1.glb", wip=C.wip("scarf"))
