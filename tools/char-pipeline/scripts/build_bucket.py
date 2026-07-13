"""Bucket hat (rigid, hat slot) -> cosmetics/hat/bucket-v1.glb.
Dome crown + 360-degree outward-flaring downward brim (lathe).
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148)); RIM_Z = 0.156

ob = C.bm_new_obj("Hat")
me = ob.data
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.054)
for v in bm.verts:
    v.co = Vector((v.co.x, v.co.y * 0.93, v.co.z * 1.04)) + CEN
bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                       plane_co=Vector((0, 0, RIM_Z)), plane_no=Vector((0, 0, 1)), clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
dome = [v for v in bm.verts if v.co.z > RIM_Z + 0.012]
for _ in range(3):
    bmesh.ops.smooth_vert(bm, verts=dome, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# brim: flaring ring, sloping down all around
r0 = math.sqrt(0.054 ** 2 - ((RIM_Z - CEN.z) / 1.04) ** 2)
C.add_lathe(bm, [(r0 - 0.001, RIM_Z, None),
                 (r0 + 0.011, RIM_Z - 0.006, None),
                 (r0 + 0.020, RIM_Z - 0.0115, None)], nseg=28, sy=0.93, cx=CEN.x)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0024, offset=1.0)
C.set_material(ob, "HatMat", (0.62, 0.56, 0.44), 0.85)   # khaki default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/bucket-v1.glb", wip=C.wip("bucket"))
