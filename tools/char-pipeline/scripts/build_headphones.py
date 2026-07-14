"""Headphones (rigid, hat slot) -> cosmetics/hat/headphones-v1.glb.
Two pancake cups hugging the giant ears + a band arcing over the crown tufts.
Authored true-size (glasses convention): manifest uses no scale/offset.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148))

ob = C.bm_new_obj("Headphones")
me = ob.data
bm = bmesh.new()

# cups: squashed spheres over the ear centers (ears y +-0.055..0.072, z 0.124..0.192)
for sgn in (1, -1):
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.021)
    for v in ret["verts"]:
        v.co = Vector((v.co.x * 1.05, v.co.y * 0.50, v.co.z * 1.15)) + Vector((0.005, sgn * 0.084, 0.160))

# band: tube arcing over the top, clearing the crown tufts (z 0.185-0.200)
path = []
for i in range(13):
    a = math.radians(-80 + 160 * i / 12)
    path.append(CEN + Vector((0, math.sin(a) * 0.081, math.cos(a) * 0.073)))
C.add_tube(bm, path, radius=0.0040, nseg=8, taper_ends=False, cap=True)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "HeadphonesMat", (0.10, 0.10, 0.11), 0.5)   # matte black default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/headphones-v1.glb", wip=C.wip("headphones"))
