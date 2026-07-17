"""Dino tail (rigid, `back` slot -> Spine01) -> cosmetics/dino/tail-v1.glb.
Tapered spiked tail whose ROOT is seated on the real lower-back surface (ray-cast,
so it meets the body flush along the true normal) then curls back and up. Part of
the Dinosaur OUTFIT.
"""
import bpy, bmesh, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()

# seat the root on the actual lower-back surface
root, nrm = C.surface_hit(body, Vector((0.0, 0.0, 0.058)), Vector((-1.0, 0.0, 0.0)))
if root is None:
    root, nrm = Vector((-0.030, 0.0, 0.058)), Vector((-1.0, 0.0, 0.0))
out = nrm.normalized()                 # outward from the back (~ -x)
p0 = root - out * 0.006                # bury the root slightly so there's no gap

ob = C.bm_new_obj("DinoTail")
me = ob.data
bm = bmesh.new()
# path grows outward along the back normal, dips, then curls up at the tip
path = [
    p0,
    p0 + out * 0.024 + Vector((0, 0, -0.008)),
    p0 + out * 0.048 + Vector((0, 0, -0.010)),
    p0 + out * 0.068 + Vector((0, 0, 0.000)),
    p0 + out * 0.082 + Vector((0, 0, 0.016)),
]
C.add_tube(bm, path, lambda t: 0.016 * (1 - t) + 0.0022, nseg=12, taper_ends=False, cap=True)

# small dorsal spikes on the top of the first two thirds, seated on the path
for i in (1, 2, 3):
    base = path[i] + Vector((0, 0, 0.011 - 0.001 * i))
    C.seat_spike(bm, base, Vector((0.15, 0, 1)).normalized(), 0.010 - 0.001 * i, 0.004, nseg=4)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.set_material(ob, "DinoMat", (0.26, 0.55, 0.24), 0.6)
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Spine01")
C.export([ob], rig, f"{C.COSDIR}/dino/tail-v1.glb", wip=C.wip("dino_tail"))
