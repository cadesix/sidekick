"""Cactus flower (rigid, `ear` slot -> Head) -> cosmetics/cactus/flower-v1.glb.
A little bloom on top of the head: pink petals + a yellow center. Part of the
Cactus OUTFIT. Two objects, one material each, both bone-parented to Head.
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
FC = Vector((0.020, 0.0, 0.200))  # top-front of the head crown

# --- petals (pink) ---
pet = C.bm_new_obj("CactusPetals")
bm = bmesh.new()
for k in range(5):
    a = 2 * math.pi * k / 5
    dx, dy = math.cos(a), math.sin(a)
    tang = Vector((-dy, dx, 0.0))
    inr, outr = 0.005, 0.017
    p_in = FC + Vector((dx * inr, dy * inr, -0.001))
    p_mid = FC + Vector((dx * (inr + outr) * 0.5, dy * (inr + outr) * 0.5, 0.004))
    p_out = FC + Vector((dx * outr, dy * outr, 0.006))
    l = p_mid + tang * 0.006
    r = p_mid - tang * 0.006
    vi = bm.verts.new(p_in)
    vl = bm.verts.new(l)
    vr = bm.verts.new(r)
    vo = bm.verts.new(p_out)
    bm.faces.new((vi, vl, vo))
    bm.faces.new((vi, vo, vr))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(pet.data); bm.free()
C.solidify(pet, 0.0016, offset=0.0)
C.set_material(pet, "CactusPetalMat", (0.94, 0.46, 0.66), 0.6)  # pink
C.smart_uv(pet)
C.rigid_parent(pet, rig, "Head")

# --- center (yellow) ---
cen = C.bm_new_obj("CactusCenter")
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.006)
for v in bm.verts:
    v.co = Vector((v.co.x, v.co.y, v.co.z * 0.6)) + FC + Vector((0, 0, 0.003))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(cen.data); bm.free()
C.set_material(cen, "CactusCenterMat", (0.98, 0.82, 0.24), 0.6)  # yellow
C.smart_uv(cen)
C.rigid_parent(cen, rig, "Head")

C.export([pet, cen], rig, f"{C.COSDIR}/cactus/flower-v1.glb", wip=C.wip("cactus_flower"))
