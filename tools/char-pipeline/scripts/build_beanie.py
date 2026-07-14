"""Beanie (rigid, hat slot) -> cosmetics/hat/beanie-v1.glb.
Tall snug dome hugging the head ball + rolled cuff torus at the rim.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148)); RIM_Z = 0.156   # cuff clears the eye line (~0.150)

ob = C.bm_new_obj("Hat")
me = ob.data
bm = bmesh.new()
# dome (covers the crown spikes at z 0.19-0.20)
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.0555)
for v in bm.verts:
    v.co = Vector((v.co.x * 1.00, v.co.y * 0.93, v.co.z * 1.08)) + CEN
bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                       plane_co=Vector((0, 0, RIM_Z)), plane_no=Vector((0, 0, 1)), clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
dome = [v for v in bm.verts if v.co.z > RIM_Z + 0.012]
for _ in range(3):
    bmesh.ops.smooth_vert(bm, verts=dome, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# rolled cuff: torus around the rim
NU, NV = 24, 8
R, r = 0.0525, 0.0058
rows = []
for j in range(NV):
    a = 2 * math.pi * j / NV
    ring = []
    for i in range(NU):
        u = 2 * math.pi * i / NU
        rr = R + r * math.cos(a)
        ring.append(bm.verts.new((CEN.x + rr * math.cos(u),
                                  0.94 * rr * math.sin(u),
                                  RIM_Z + 0.001 + r * math.sin(a))))
    rows.append(ring)
for j in range(NV):
    a, b = rows[j], rows[(j + 1) % NV]
    for i in range(NU):
        bm.faces.new((a[i], a[(i + 1) % NU], b[(i + 1) % NU], b[i]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0024, offset=1.0)
C.set_material(ob, "HatMat", (0.10, 0.10, 0.12), 0.9)   # charcoal knit default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/beanie-v1.glb", wip=C.wip("beanie"))
