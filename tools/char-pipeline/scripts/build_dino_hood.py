"""Dino hood (rigid, hat slot -> Head) -> cosmetics/dino/hood-v1.glb.
A head-CONFORMING shell, not a floating dome: duplicate the real head surface
(inherits its exact shape incl. ears), offset out a hair, open the face, seat a
dorsal crest on the true surface, solidify. Part of the Dinosaur OUTFIT.
"""
import bpy, bmesh, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148))
OFFSET = 0.0042     # sit just off the head
FRONT_X = 0.030     # open the face in front of this x
NECK_Z = 0.107      # trim the bottom at the neck

# duplicate the REAL head surface (dominant "Head", FaceSprite auto-dropped)
ob = C.dup_region(body, "DinoHood", keep=["Head"])
C.strip_skin(ob)                       # rigid, no weights
C.offset_loosen(ob, OFFSET, loops=2)   # push out along the real normals + relax
C.cut(ob, (0, 0, NECK_Z), (0, 0, 1), clear_inner=True)   # trim neck-down
C.cut(ob, (FRONT_X, 0, 0), (1, 0, 0), clear_outer=True)  # open the face
C.decimate(ob, 700)                                       # lightweight shell

# dorsal crest, SEATED on the true head surface along the sagittal ridge
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
CREST = [  # (dir from CEN, spike length)
    (Vector((0.35, 0.0, 0.94)), 0.012),
    (Vector((0.06, 0.0, 1.00)), 0.018),
    (Vector((-0.24, 0.0, 0.97)), 0.022),
    (Vector((-0.54, 0.0, 0.84)), 0.018),
    (Vector((-0.76, 0.0, 0.62)), 0.012),
]
for d, ln in CREST:
    pt, nrm = C.surface_hit(body, CEN, d)
    if pt is None:
        continue
    n = (nrm * 0.5 + Vector((0, 0, 1)) * 0.5).normalized()  # lean the crest upward
    C.seat_spike(bm, pt + n * (OFFSET + 0.001), n, ln, 0.006, nseg=4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free(); me.update()

C.solidify(ob, 0.0026, offset=1.0)
C.set_material(ob, "DinoMat", (0.26, 0.55, 0.24), 0.6)
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/dino/hood-v1.glb", wip=C.wip("dino_hood"))
