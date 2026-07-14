"""Cat-ear beanie (rigid, hat slot) -> cosmetics/hat/catbeanie-v1.glb.
Beanie dome + rolled cuff (build_beanie pattern) with two cat-ear cones on top.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148)); RIM_Z = 0.161

ob = C.bm_new_obj("Catbeanie")
me = ob.data
bm = bmesh.new()

# dome
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.0555)
for v in bm.verts:
    v.co = Vector((v.co.x * 1.00, v.co.y * 0.93, v.co.z * 1.08)) + CEN
bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                       plane_co=Vector((0, 0, RIM_Z)), plane_no=Vector((0, 0, 1)), clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
dome = [v for v in bm.verts if v.co.z > RIM_Z + 0.012]
for _ in range(3):
    bmesh.ops.smooth_vert(bm, verts=dome, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)

# rolled cuff
NU, NV = 24, 8
R, r = 0.0525, 0.0058
rows = []
for j in range(NV):
    a = 2 * math.pi * j / NV
    ring = []
    for i in range(NU):
        u = 2 * math.pi * i / NU
        rr = R + r * math.cos(a)
        ring.append(bm.verts.new((CEN.x + rr * math.cos(u), 0.94 * rr * math.sin(u),
                                  RIM_Z + 0.001 + r * math.sin(a))))
    rows.append(ring)
for j in range(NV):
    a, b = rows[j], rows[(j + 1) % NV]
    for i in range(NU):
        bm.faces.new((a[i], a[(i + 1) % NU], b[(i + 1) % NU], b[i]))

# cat ears: cones on the dome's top corners, tilted slightly outward
for sgn in (1, -1):
    y0 = sgn * 0.0300
    zb = 0.1940                       # dome surface height at |y|~0.030
    tip = Vector((0.005, y0 + sgn * 0.006, zb + 0.0175))
    rings = [(0.0135, 0.0), (0.0100, 0.35), (0.0045, 0.75)]
    rows = []
    for (rr, t) in rings:
        base = Vector((0.005, y0, zb - 0.004))
        c = base.lerp(tip, t)
        row = [bm.verts.new((c.x + rr * math.cos(2 * math.pi * i / 10),
                             c.y + rr * 0.55 * math.sin(2 * math.pi * i / 10), c.z))
               for i in range(10)]
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for i in range(10):
            bm.faces.new((a[i], a[(i + 1) % 10], b[(i + 1) % 10], b[i]))
    vt = bm.verts.new(tip)
    for i in range(10):
        bm.faces.new((rows[-1][i], rows[-1][(i + 1) % 10], vt))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0024, offset=1.0)
C.set_material(ob, "CatbeanieMat", (0.13, 0.12, 0.14), 0.9)   # black cat default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/hat/catbeanie-v1.glb", wip=C.wip("catbeanie"))
