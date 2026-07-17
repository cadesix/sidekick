"""Cactus flower (rigid, `ear` slot -> Head) -> cosmetics/cactus/flower-v1.glb.
A bloom SEATED on the real crown surface (ray-cast, so it sits flush on the head
instead of floating): pink petals + a yellow center. Part of the Cactus OUTFIT.
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

body, rig = C.load_master()
CEN = Vector((0.005, 0.0, 0.148))

# seat point on the real crown, slightly forward of top
pt, nrm = C.surface_hit(body, CEN, Vector((0.28, 0.0, 0.96)).normalized())
if pt is None:
    pt, nrm = Vector((0.02, 0.0, 0.200)), Vector((0, 0, 1))
up = nrm.normalized()
FC = pt + up * 0.004  # base sits just on the surface
# local frame on the surface
ref = Vector((1, 0, 0)) if abs(up.z) > 0.5 else Vector((0, 0, 1))
tx = up.cross(ref).normalized()
ty = up.cross(tx).normalized()

# --- petals (pink) ---
pet = C.bm_new_obj("CactusPetals")
bm = bmesh.new()
for k in range(5):
    a = 2 * math.pi * k / 5
    rad = tx * math.cos(a) + ty * math.sin(a)   # radial in the surface tangent plane
    tang = -tx * math.sin(a) + ty * math.cos(a)
    inr, outr = 0.005, 0.017
    p_in = FC + rad * inr
    p_mid = FC + rad * ((inr + outr) * 0.5) + up * 0.004
    p_out = FC + rad * outr + up * 0.006
    l = p_mid + tang * 0.006
    r = p_mid - tang * 0.006
    vi = bm.verts.new(p_in); vl = bm.verts.new(l); vr = bm.verts.new(r); vo = bm.verts.new(p_out)
    bm.faces.new((vi, vl, vo)); bm.faces.new((vi, vo, vr))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(pet.data); bm.free()
C.solidify(pet, 0.0016, offset=0.0)
C.set_material(pet, "CactusPetalMat", (0.94, 0.46, 0.66), 0.6)
C.smart_uv(pet)
C.rigid_parent(pet, rig, "Head")

# --- center (yellow) ---
cen = C.bm_new_obj("CactusCenter")
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.006)
for v in bm.verts:
    v.co = Vector((v.co.x, v.co.y, v.co.z * 0.6)) + FC + up * 0.003
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(cen.data); bm.free()
C.set_material(cen, "CactusCenterMat", (0.98, 0.82, 0.24), 0.6)
C.smart_uv(cen)
C.rigid_parent(cen, rig, "Head")

C.export([pet, cen], rig, f"{C.COSDIR}/cactus/flower-v1.glb", wip=C.wip("cactus_flower"))
