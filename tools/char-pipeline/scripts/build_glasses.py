"""Sunglasses (rigid, NEW `glasses` slot -> Head bone) -> cosmetics/glasses/base-v1.glb.
Two round lens slabs that fully cover the eyes of the face sprite + bridge +
temple arms curving around the head sides. One mesh `Glasses`, one material.

Eye placement is measured from the SERVED sheet (face-sheet-v6.png) under the
prod look preset (cel-bloom-tilt-5173: faceZoom 0.9, faceHeight 0.185), which
renders features higher/wider than the raw doc eye line: eye centers land at
y=+-0.0222 (per-expression spread 0.020-0.025), z 0.147-0.154, eye ovals
~0.009 x 0.015. Lenses r=0.014 at (+-0.0223, 0.1505) cover every measured
expression's eyes with margin (measurement: scratchpad measure_eyes.py run
2026-07-13; re-measure if the sheet or the preset's face fields change).
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
HC = Vector((0.005, 0.0, 0.148))          # head center
EYE_Z = 0.1505; LENS_R = 0.0140; LENS_Y = 0.0223
X0, X1 = 0.0475, 0.0505                    # lens slab depth (proud of face disc)

ob = C.bm_new_obj("Glasses")
me = ob.data
bm = bmesh.new()

def lens(sy):
    n = 16
    lo, hi = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        y = sy * LENS_Y + LENS_R * math.cos(a)
        z = EYE_Z + LENS_R * math.sin(a)
        lo.append(bm.verts.new((X0, y, z)))
        hi.append(bm.verts.new((X1, y, z)))
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    cl = bm.verts.new((X0, sy * LENS_Y, EYE_Z)); ch = bm.verts.new((X1, sy * LENS_Y, EYE_Z))
    for i in range(n):
        bm.faces.new((lo[(i + 1) % n], lo[i], cl))
        bm.faces.new((hi[i], hi[(i + 1) % n], ch))

lens(1); lens(-1)

# bridge between the lenses (spans the inter-lens gap with ~2mm overlap each side)
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
C.add_slab(bm, Vector((X0 + 0.0005, 0, EYE_Z + 0.002)), Y, Z, X,
           2 * (LENS_Y - LENS_R) + 0.004, 0.004, 0.0015, 0.0025)

# temple arms: strips sweeping around the head sides toward the ears
for sy in (1, -1):
    a2, b2 = 0.0555, 0.053                 # head ellipse + clearance
    rows = []
    NSEG = 8
    # start where the (now wider) lens rim sits: y = LENS_Y + LENS_R
    th0 = math.degrees(math.asin(min(1.0, (LENS_Y + LENS_R) / b2)))
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
        f = bm.faces.new(q if flip else tuple(reversed(q)))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "GlassesMat", (0.015, 0.015, 0.018), 0.25)   # gloss black
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/glasses/base-v1.glb", wip=C.wip("glasses"))
