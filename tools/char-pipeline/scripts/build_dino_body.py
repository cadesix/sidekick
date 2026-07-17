"""Dino onesie body (skinned) -> cosmetics/dino/body-v1.glb.
A full-body green suit covering the sidekick neck-down: torso + arms (to the
paws) + legs (to the ankles). Same skinned-garment pattern as shirt/pants
(duplicate body surface -> exact weights, bisect neck + ankle, offset out,
decimate, snap+relax boundaries, solidify), just covering the whole body.
Part of the Dinosaur OUTFIT; the head stays bare (the hood covers it).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

bpy.ops.wm.open_mainfile(filepath=C.MASTER)
body = max([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: len(o.data.vertices))
rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
mw = body.matrix_world; mwi = mw.inverted()

NECK_Z = 0.100     # clean neck hole (head sticks out above)
ANKLE_Z = 0.014    # hem at the ankles (feet bare)
WRIST_Y = 0.072    # sleeves end at the wrist (paws stay bare) — arms are out at bind
OFFSET = 0.0038    # a touch puffier than the shirt
TARGET_TRIS = 1600
THICK = 0.0024
EXCLUDE_SUB = ("Head",)  # keep the WHOLE body below the head
gi = {g.index: g.name for g in body.vertex_groups}
fs_idx = list(body.data.materials).index(bpy.data.materials["FaceSprite"])

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.duplicate()
suit = bpy.context.view_layer.objects.active
suit.name = "DinoBody"; suit.data.name = "DinoBody"
me = suit.data

def dom(poly):
    acc = {}
    for vi in poly.vertices:
        for g in me.vertices[vi].groups:
            acc[gi[g.group]] = acc.get(gi[g.group], 0) + g.weight
    return max(acc, key=acc.get) if acc else ""

doom = {p.index for p in me.polygons
        if p.material_index == fs_idx or any(s in dom(p) for s in EXCLUDE_SUB) or not dom(p)}
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in doom], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

def cut(co, no, **kw):
    bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                           plane_co=mwi @ Vector(co), plane_no=mwi.to_3x3() @ Vector(no), **kw)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
cut((0, 0, NECK_Z), (0, 0, 1), clear_outer=True)   # trim neck stub -> clean collar
cut((0, 0, ANKLE_Z), (0, 0, 1), clear_inner=True)  # remove feet below the ankle
cut((0, WRIST_Y, 0), (0, 1, 0), clear_outer=True)  # sleeve ends at the wrist (+y arm)
cut((0, -WRIST_Y, 0), (0, 1, 0), clear_inner=True) # sleeve ends at the wrist (-y arm)

bm.normal_update()
for v in bm.verts:
    v.co = v.co + v.normal * OFFSET
inner = [v for v in bm.verts if not any(len(e.link_faces) == 1 for e in v.link_edges)]
for _ in range(2):
    bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free(); me.update()

dec = suit.modifiers.new("dec", "DECIMATE")
me.calc_loop_triangles()
dec.ratio = min(1.0, TARGET_TRIS / max(1, len(me.loop_triangles)))
bpy.ops.object.select_all(action="DESELECT"); suit.select_set(True)
bpy.context.view_layer.objects.active = suit
bpy.ops.object.modifier_apply(modifier="dec")

# snap collar + ankle rims to their planes, relax loops (LAST geo step)
bm = bmesh.new(); bm.from_mesh(me)
for v in bm.verts:
    if not any(len(e.link_faces) == 1 for e in v.link_edges):
        continue
    p = mw @ v.co
    if abs(p.z - NECK_Z) < 0.010:
        p.z = NECK_Z; v.co = mwi @ p
    elif abs(p.z - ANKLE_Z) < 0.008:
        p.z = ANKLE_Z; v.co = mwi @ p
    elif abs(abs(p.y) - WRIST_Y) < 0.008:
        p.y = math.copysign(WRIST_Y, p.y); v.co = mwi @ p
for _ in range(14):
    bv = [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]
    np_ = {}
    for v in bv:
        nb = [e.other_vert(v) for e in v.link_edges if len(e.link_faces) == 1]
        if len(nb) == 2:
            np_[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
    for v, co in np_.items():
        v.co = co
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free(); me.update()

sol = suit.modifiers.new("sol", "SOLIDIFY"); sol.thickness = THICK; sol.offset = -1.0; sol.use_rim = True
bpy.ops.object.modifier_apply(modifier="sol")

me.materials.clear()
mat = bpy.data.materials.new("DinoMat"); mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.26, 0.55, 0.24, 1.0)  # dino green
bsdf.inputs["Roughness"].default_value = 0.6
me.materials.append(mat)
for p in me.polygons:
    p.use_smooth = True
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
bpy.ops.object.mode_set(mode="OBJECT")
me.calc_loop_triangles()
print(f"dino-body: {len(me.vertices)} verts, {len(me.loop_triangles)} tris")

bpy.ops.wm.save_as_mainfile(filepath=C.wip("dino_body"))
bpy.ops.object.select_all(action="DESELECT")
suit.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = suit
out = f"{C.COSDIR}/dino/body-v1.glb"
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True,
                          export_skins=True, export_yup=True, export_apply=False)
print("exported", out)
