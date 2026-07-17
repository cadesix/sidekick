"""Cactus spikes (rigid, hat slot -> Head) -> cosmetics/cactus/spikes-v1.glb.
Spines SEATED on the real head surface: each one is ray-cast against the actual
body mesh from the head center, so it sits flush and points along the true
surface normal (follows the ears/curves) instead of floating on a guessed sphere.
Front face band is left clear. Part of the Cactus OUTFIT (green material + these).
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148))  # ray origin (inside the head)
LEN = 0.010
RR = 0.0020

# deterministic outward directions over the upper hemisphere; the actual seat
# point + orientation come from ray-casting the mesh, not from these dirs.
dirs = []
for iz in range(5):
    z = 0.10 + 0.85 * iz / 4
    ring_r = math.sqrt(max(0.0, 1.0 - z * z))
    n = max(4, int(round(13 * ring_r)))
    for j in range(n):
        a = 2 * math.pi * (j + 0.35 * iz) / n
        d = Vector((ring_r * math.cos(a), ring_r * math.sin(a), z))
        if d.x > 0.45 and d.z < 0.6:  # skip the front face band
            continue
        dirs.append(d.normalized())

ob = C.bm_new_obj("CactusSpikes")
bm = bmesh.new()
seated = 0
for d in dirs:
    pt, nrm = C.surface_hit(body, CEN, d)
    if pt is None:
        continue
    # blend the mesh normal toward the radial dir a touch so spines splay outward
    n = (nrm * 0.7 + d * 0.3).normalized()
    C.seat_spike(bm, pt + n * 0.0006, n, LEN, RR)
    seated += 1
print("seated spikes:", seated, "/", len(dirs))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(ob.data); bm.free()

C.set_material(ob, "CactusSpikeMat", (0.90, 0.91, 0.74), 0.7)
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/cactus/spikes-v1.glb", wip=C.wip("cactus_spikes"))
