"""Daisy tucked behind the ear (rigid, NEW ear slot) -> cosmetics/ear/flower-v1.glb.
Six petals + center button at the front root of the character-left ear (+Y),
petal plane tilted outward/up like it's tucked behind the ear.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
P = Vector((0.0300, 0.0530, 0.1700))          # ear front root
N = Vector((0.62, 0.58, 0.53)).normalized()   # petal-plane normal: out + left + up
U = N.cross(Vector((0, 0, 1))).normalized()
W = N.cross(U).normalized()

ob = C.bm_new_obj("Flower")
me = ob.data
bm = bmesh.new()

# petals: flattened spheres around the center
NP = 6
for k in range(NP):
    a = 2 * math.pi * k / NP
    d = (U * math.cos(a) + W * math.sin(a)).normalized()
    s = d.cross(N)
    ctr = P + d * 0.0078
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in ret["verts"]:
        v.co = ctr + d * (v.co.x * 0.0062) + s * (v.co.y * 0.0038) + N * (v.co.z * 0.0016)
# center button
ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
for v in ret["verts"]:
    v.co = P + U * (v.co.x * 0.0038) + W * (v.co.y * 0.0038) + N * (v.co.z * 0.0024 + 0.0012)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "FlowerMat", (0.96, 0.94, 0.90), 0.6)   # daisy white default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/ear/flower-v1.glb", wip=C.wip("flower"))
