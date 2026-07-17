"""Dino tail (rigid, `back` slot -> Spine01) -> cosmetics/dino/tail-v1.glb.
A tapered tail curving off the lower back, with a small dorsal spike row. Part of
the Dinosaur OUTFIT. Back surface ~x -0.023..-0.034; waist z ~0.046-0.054.
"""
import bpy, bmesh, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()

ob = C.bm_new_obj("DinoTail")
me = ob.data
bm = bmesh.new()

# tail path: off the lower back (-x), dipping then curling up at the tip
path = [
    Vector((-0.028, 0.0, 0.062)),
    Vector((-0.050, 0.0, 0.052)),
    Vector((-0.072, 0.0, 0.050)),
    Vector((-0.091, 0.0, 0.058)),
    Vector((-0.104, 0.0, 0.073)),
]
verts = C.add_tube(bm, path, lambda t: 0.015 * (1 - t) + 0.0022, nseg=12,
                   taper_ends=False, cap=True)

# small spikes along the top of the first two thirds
SPIKES = [
    (-0.040, 0.0, 0.061, 0.010),
    (-0.062, 0.0, 0.059, 0.009),
    (-0.083, 0.0, 0.062, 0.007),
]
for (sx, sy, sz, h) in SPIKES:
    hw, bd = 0.005, 0.005
    b0 = bm.verts.new((sx + hw, bd, sz))
    b1 = bm.verts.new((sx - hw, bd, sz))
    b2 = bm.verts.new((sx - hw, -bd, sz))
    b3 = bm.verts.new((sx + hw, -bd, sz))
    apex = bm.verts.new((sx - hw * 0.3, 0.0, sz + h))
    bm.faces.new((b0, b1, b2, b3))
    for a, c in [(b0, b1), (b1, b2), (b2, b3), (b3, b0)]:
        bm.faces.new((a, c, apex))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "DinoMat", (0.26, 0.55, 0.24), 0.6)  # dino green
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Spine01")
C.export([ob], rig, f"{C.COSDIR}/dino/tail-v1.glb", wip=C.wip("dino_tail"))
