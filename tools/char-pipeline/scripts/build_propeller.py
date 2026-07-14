"""Propeller cap (rigid, hat slot) -> cosmetics/hat/propeller-v1.glb.
Snug skull cap covering the crown tufts + stem, hub, and 4 flat blades.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148)); RIM_Z = 0.160

ob = C.bm_new_obj("Propeller")
me = ob.data
bm = bmesh.new()

# skull cap (top z ~0.207 covers the tufts at 0.185-0.200)
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.0555)
for v in bm.verts:
    v.co = Vector((v.co.x * 1.00, v.co.y * 0.92, v.co.z * 1.06)) + CEN
bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                       plane_co=Vector((0, 0, RIM_Z)), plane_no=Vector((0, 0, 1)), clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

# stem + hub
C.add_lathe(bm, [(0.0034, 0.2060, 0.005), (0.0030, 0.2205, 0.005)], nseg=10, sy=1.0, cx=0.005)
ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.0050)
for v in ret["verts"]:
    v.co = Vector((v.co.x, v.co.y, v.co.z * 0.8)) + Vector((0.005, 0, 0.2225))

# 4 blades, horizontal, slight pitch
Zax = Vector((0, 0, 1))
for k in range(4):
    a = math.pi / 4 + k * math.pi / 2
    d = Vector((math.cos(a), math.sin(a), 0))
    perp = Zax.cross(d)
    az = (Zax + perp * 0.25).normalized()   # pitched blade
    C.add_slab(bm, Vector((0.005, 0, 0.2215)) + d * 0.0155, d, perp, az,
               0.024, 0.0080, 0.0030, 0.0018, scales=(1.0, 1.0))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0022, offset=1.0)
C.set_material(ob, "PropellerMat", (0.80, 0.25, 0.20), 0.55)   # toy red default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/propeller-v1.glb", wip=C.wip("propeller"))
