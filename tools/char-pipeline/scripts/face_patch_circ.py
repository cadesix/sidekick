"""FaceSprite as a CIRCULAR decal filling the head's round frontal cap.
Radial grid conformed to the head, offset out, planar UV (disc inscribed in the
[0,1] canvas). Max frontal coverage without wrapping the crown/sides. Replaces
the old FaceSprite; single primitive, own material, 100% Head, joined into the mesh.
Usage: blender --background --python face_patch_circ.py -- <in_blend> <out_blend> <out_glb>
"""
import bpy, bmesh, sys, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

in_blend, out_blend, out_glb = sys.argv[sys.argv.index("--") + 1:]

CZ = 0.137           # lowered so the disc top clears the crown spikes (z 0.185)
RY = 0.043           # frontal half-width
RZ = 0.043           # circular; top = CZ+RZ = 0.180 < spikes 0.185
OFFSET = 0.0008
RINGS, SEGS = 13, 44
UV_LO, UV_HI = 0.015, 0.985

bpy.ops.wm.open_mainfile(filepath=in_blend)
mesh = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
mw = mesh.matrix_world; mwi = mw.inverted(); me = mesh.data

# --- remove old FaceSprite decal ---
fs_mat = bpy.data.materials["FaceSprite"]
fs_idx = list(me.materials).index(fs_mat)
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == fs_idx], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(me); bm.free(); me.update()

# --- build circular radial grid conformed to the head ---
bvh = BVHTree.FromObject(mesh, bpy.context.evaluated_depsgraph_get())
pm = bpy.data.meshes.new("FaceSpritePatch")
bmp = bmesh.new()
grid = {}; bad = set()
for ri in range(RINGS + 1):
    r = ri / RINGS
    for si in range(SEGS):
        if ri == 0 and si > 0:
            continue
        th = 2 * math.pi * si / SEGS
        y = RY * r * math.cos(th)
        z = CZ + RZ * r * math.sin(th)
        hit = bvh.ray_cast(mwi @ Vector((0.25, y, z)), mwi.to_3x3() @ Vector((-1, 0, 0)))
        loc, nrm = hit[0], hit[1]
        if loc is None or (mw.to_3x3() @ nrm).normalized().x < 0.20:
            bad.add((ri, si)); v = bmp.verts.new(mwi @ Vector((0.03, y, z)))
        else:
            v = bmp.verts.new(loc + nrm.normalized() * OFFSET)
        grid[(ri, si)] = v
for ri in range(1, RINGS + 1):        # extrapolate grazing rim verts from inner rings
    for si in range(SEGS):
        if (ri, si) in bad and ri >= 2:
            grid[(ri, si)].co = grid[(ri - 1, si)].co * 2 - grid[(ri - 2, si)].co
print(f"disc: {len(grid)} verts ({len(bad)} rim verts extrapolated)")
for ri in range(RINGS):
    for si in range(SEGS):
        sj = (si + 1) % SEGS
        if ri == 0:
            bmp.faces.new((grid[(0, 0)], grid[(1, si)], grid[(1, sj)]))
        else:
            bmp.faces.new((grid[(ri, si)], grid[(ri + 1, si)], grid[(ri + 1, sj)], grid[(ri, sj)]))
bmesh.ops.recalc_face_normals(bmp, faces=bmp.faces)
if sum(((mw.to_3x3() @ f.normal) for f in bmp.faces), Vector()).x < 0:
    for f in bmp.faces:
        f.normal_flip()
for f in bmp.faces:
    f.smooth = True

# planar UV: disc inscribed in the [0,1] canvas (edge -> UV rim, corners empty)
def cl(t): return UV_LO if t < UV_LO else (UV_HI if t > UV_HI else t)
uvl = bmp.loops.layers.uv.new("UVMap")
for f in bmp.faces:
    for l in f.loops:
        p = mw @ l.vert.co
        u = cl(0.5 + (0.0 - p.y) / (2 * RY))
        v = cl(0.5 + (p.z - CZ) / (2 * RZ))
        l[uvl].uv = (u, v)
bmp.to_mesh(pm); bmp.free()

patch = bpy.data.objects.new("FaceSprite", pm)
bpy.context.scene.collection.objects.link(patch)
patch.data.materials.append(fs_mat)
patch.vertex_groups.new(name="Head").add(list(range(len(pm.vertices))), 1.0, "REPLACE")
bpy.ops.object.select_all(action="DESELECT")
patch.select_set(True); mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
bpy.ops.object.mode_set(mode="OBJECT")
me.calc_loop_triangles()
print(f"joined: {len(me.vertices)} verts, {len(me.loop_triangles)} tris")

bpy.ops.wm.save_as_mainfile(filepath=out_blend)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB")
print("saved", out_blend, out_glb)
