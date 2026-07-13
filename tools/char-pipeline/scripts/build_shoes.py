"""Shoes cosmetic (RIGID, two meshes) -> cosmetics/shoes/base-v1.glb.
Shoe_L parented to L_Calf, Shoe_R to R_Calf (feet are rigid relative to the calf;
no foot bone). Each is a shell hugging that foot (duplicate foot+toe surface,
offset out, ankle rim, solidify). Both share ONE material so a variant drives both.
"""
import bpy, bmesh, math
from mathutils import Vector
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

bpy.ops.wm.open_mainfile(filepath=C.MASTER)
body = max([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: len(o.data.vertices))
rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
mw = body.matrix_world; mwi = mw.inverted()
gi = {g.index: g.name for g in body.vertex_groups}
fs_idx = list(body.data.materials).index(bpy.data.materials["FaceSprite"])
SHOE_TOP = 0.021; OFFSET = 0.0030; THICK = 0.0022

# shared material for both shoes (variant swaps this one map)
mat = bpy.data.materials.new("ShoeMat"); mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.72, 0.20, 0.18, 1.0)  # sneaker red default
bsdf.inputs["Roughness"].default_value = 0.6

def dom(me, poly):
    acc = {}
    for vi in poly.vertices:
        for g in me.vertices[vi].groups:
            acc[gi[g.group]] = acc.get(gi[g.group], 0) + g.weight
    return max(acc, key=acc.get) if acc else ""

def build_shoe(side):
    keep = {f"{side}_Foot", f"{side}_ToeBase"}
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    shoe = bpy.context.view_layer.objects.active
    shoe.name = f"Shoe_{side}"; shoe.data.name = f"Shoe_{side}"
    me = shoe.data
    doom = {p.index for p in me.polygons if p.material_index == fs_idx or dom(me, p) not in keep}
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in doom], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                           plane_co=mwi @ Vector((0, 0, SHOE_TOP)), plane_no=mwi.to_3x3() @ Vector((0, 0, 1)),
                           clear_outer=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    for v in bm.verts:
        v.co = v.co + v.normal * OFFSET
    inner = [v for v in bm.verts if not any(len(e.link_faces) == 1 for e in v.link_edges)]
    for _ in range(2):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # relax + snap ankle rim to the cut plane
    for _ in range(10):
        bv = [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]
        np_ = {}
        for v in bv:
            nb = [e.other_vert(v) for e in v.link_edges if len(e.link_faces) == 1]
            if len(nb) == 2:
                np_[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, co in np_.items():
            v.co = co
    for v in bm.verts:
        if any(len(e.link_faces) == 1 for e in v.link_edges):
            p = mw @ v.co; p.z = SHOE_TOP; v.co = mwi @ p
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()
    dec = shoe.modifiers.new("dec", "DECIMATE"); me.calc_loop_triangles()
    dec.ratio = min(1.0, 320 / max(1, len(me.loop_triangles)))
    bpy.ops.object.select_all(action="DESELECT"); shoe.select_set(True); bpy.context.view_layer.objects.active = shoe
    bpy.ops.object.modifier_apply(modifier="dec")
    sol = shoe.modifiers.new("sol", "SOLIDIFY"); sol.thickness = THICK; sol.offset = -1.0; sol.use_rim = True
    bpy.ops.object.modifier_apply(modifier="sol")
    # remove skin: rigid shoe has no vertex groups / armature
    shoe.vertex_groups.clear()
    for m in list(shoe.modifiers):
        shoe.modifiers.remove(m)
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    # origin at calf bone, parent to calf bone (rigid)
    calf_world = rig.matrix_world @ rig.data.bones[f"{side}_Calf"].head_local
    bpy.context.scene.cursor.location = calf_world
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.ops.object.select_all(action="DESELECT")
    shoe.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE"); rig.data.bones.active = rig.data.bones[f"{side}_Calf"]
    bpy.ops.object.parent_set(type="BONE", keep_transform=True); bpy.ops.object.mode_set(mode="OBJECT")
    me.calc_loop_triangles()
    print(f"Shoe_{side}: {len(me.vertices)} verts, {len(me.loop_triangles)} tris, parent={shoe.parent_bone}")
    return shoe

sL = build_shoe("L"); sR = build_shoe("R")
bpy.ops.wm.save_as_mainfile(filepath=C.wip("shoes"))
bpy.ops.object.select_all(action="DESELECT")
sL.select_set(True); sR.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = sL
import os
out = f"{C.COSDIR}/shoes/base-v1.glb"
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True)
print("exported", out)
