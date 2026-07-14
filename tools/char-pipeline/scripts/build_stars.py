"""Star-shaped glasses (rigid, glasses slot) -> cosmetics/glasses/stars-v1.glb.
Five-point star lenses centered on the measured eye positions (see
build_glasses.py docstring: eyes at y +-0.0223, z 0.1505 under the prod
preset; star inner radius 0.0095 > eye half-extents 0.0045/0.0076 so the
eyes stay fully covered) + bridge + temple arms.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
HC = Vector((0.005, 0.0, 0.148))
EYE_Z = 0.1505; LENS_Y = 0.0223
R_OUT, R_IN = 0.0175, 0.0095
X0, X1 = 0.0475, 0.0512   # lens front proud of the bridge (avoids coplanar z-fight)

ob = C.bm_new_obj("Stars")
me = ob.data
bm = bmesh.new()

def star(sy):
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5          # point-up
        r = R_OUT if i % 2 == 0 else R_IN
        pts.append((sy * LENS_Y + r * math.cos(a), EYE_Z + r * math.sin(a)))
    lo = [bm.verts.new((X0, y, z)) for (y, z) in pts]
    hi = [bm.verts.new((X1, y, z)) for (y, z) in pts]
    n = len(pts)
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    cl = bm.verts.new((X0, sy * LENS_Y, EYE_Z)); ch = bm.verts.new((X1, sy * LENS_Y, EYE_Z))
    for i in range(n):
        bm.faces.new((lo[(i + 1) % n], lo[i], cl))
        bm.faces.new((hi[i], hi[(i + 1) % n], ch))

star(1); star(-1)

# bridge
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
C.add_slab(bm, Vector((X0 + 0.0005, 0, EYE_Z + 0.002)), Y, Z, X,
           2 * (LENS_Y - R_IN) + 0.004, 0.004, 0.0015, 0.0025)

# temple arms (glasses pattern), starting at the star's outer side point
for sy in (1, -1):
    a2, b2 = 0.0555, 0.053
    th0 = math.degrees(math.asin(min(1.0, (LENS_Y + R_IN + 0.004) / b2)))
    rows = []
    NSEG = 8
    for i in range(NSEG + 1):
        th = math.radians(th0 + (95 - th0) * i / NSEG)
        p = Vector((HC.x + a2 * math.cos(th), sy * b2 * math.sin(th), EYE_Z))
        radial = Vector((math.cos(th), sy * math.sin(th), 0))
        rows.append((p, radial))
    quads = []
    for (p, rad) in rows:
        v1 = bm.verts.new(p + Vector((0, 0, 0.002)))
        v2 = bm.verts.new(p + Vector((0, 0, -0.002)))
        v3 = bm.verts.new(p + Vector((0, 0, -0.002)) - rad * 0.0015)
        v4 = bm.verts.new(p + Vector((0, 0, 0.002)) - rad * 0.0015)
        quads.append((v1, v2, v3, v4))
    for qa, qb in zip(quads, quads[1:]):
        for k in range(4):
            bm.faces.new((qa[k], qa[(k + 1) % 4], qb[(k + 1) % 4], qb[k]))
    for q, flip in ((quads[0], False), (quads[-1], True)):
        bm.faces.new(q if flip else tuple(reversed(q)))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = False   # crisp facets; smooth shading bands on the flat star caps
bm.to_mesh(me); bm.free()

C.set_material(ob, "StarsMat", (0.82, 0.60, 0.16), 0.35, metallic=0.15)   # gold star default
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/glasses/stars-v1.glb", wip=C.wip("stars"))
