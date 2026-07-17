"""Dino hood (rigid, hat slot) -> cosmetics/dino/hood-v1.glb.
An open-faced hood shell over the upper head + a dorsal spike crest. Part of the
Dinosaur OUTFIT (a pure costume — the body keeps its own skin). Open front so the
FaceSprite eyes/mouth read through (same idea as the crown's open top).
"""
import bpy, bmesh, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148))  # head-ball center
R = 0.060                          # hood radius (head radius ~0.053 + clearance)
FRONT_X = 0.020                    # open the face in front of this x
BOT_Z = 0.146                      # hood covers the upper head (eye line ~0.150)

ob = C.bm_new_obj("DinoHood")
me = ob.data
bm = bmesh.new()
# dome shell hugging the head
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=R)
for v in bm.verts:
    v.co = Vector((v.co.x * 1.02, v.co.y * 0.98, v.co.z * 1.05)) + CEN
# keep only the upper head
bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                       plane_co=Vector((0, 0, BOT_Z)), plane_no=Vector((0, 0, 1)),
                       clear_inner=True)
# open the FACE — remove the front cap so the sprite shows
bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                       plane_co=Vector((FRONT_X, 0, 0)), plane_no=Vector((1, 0, 0)),
                       clear_outer=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

# dorsal spike crest along the top ridge (y=0), front -> back, grow then shrink
# (x, base_z, height, half_width)
SPIKES = [
    (0.014, 0.198, 0.011, 0.006),
    (-0.010, 0.207, 0.017, 0.008),
    (-0.036, 0.204, 0.021, 0.009),
    (-0.060, 0.191, 0.017, 0.008),
    (-0.078, 0.173, 0.011, 0.006),
]
for (sx, sz, h, hw) in SPIKES:
    bd = 0.006  # base half-depth (y)
    b0 = bm.verts.new((sx + hw, bd, sz))
    b1 = bm.verts.new((sx - hw, bd, sz))
    b2 = bm.verts.new((sx - hw, -bd, sz))
    b3 = bm.verts.new((sx + hw, -bd, sz))
    apex = bm.verts.new((sx - hw * 0.3, 0.0, sz + h))  # lean tips slightly back
    bm.faces.new((b0, b1, b2, b3))  # base
    for a, c in [(b0, b1), (b1, b2), (b2, b3), (b3, b0)]:
        bm.faces.new((a, c, apex))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

C.solidify(ob, 0.0026, offset=1.0)
C.set_material(ob, "DinoMat", (0.26, 0.55, 0.24), 0.6)  # dino green
C.smart_uv(ob)
C.rigid_parent(ob, rig, "Head")
C.export([ob], rig, f"{C.COSDIR}/dino/hood-v1.glb", wip=C.wip("dino_hood"))
