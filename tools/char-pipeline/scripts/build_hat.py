"""Regular baseball cap, parented to the Head bone (rigid, not skinned).

Two explicit parametric pieces:
  1. CROWN - rounded dome hugging the head ball between the huge ears,
             rim level just above the eyes, tall enough to cover the crown
             spikes (z 0.19-0.20).
  2. BILL  - semi-elliptical curved brim springing from the front rim:
             mostly-forward projection, modest droop, side edges curling
             down slightly (classic curved bill), rounded tip.
Plus the little button on top. One HatMat, solidified for cloth thickness.
"""
import bpy, bmesh, math
from mathutils import Vector
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

bpy.ops.wm.open_mainfile(filepath=C.MASTER)
rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
head_bone_world = rig.matrix_world @ rig.data.bones["Head"].head_local

# --- head reference frame (yellow char: head ball center, spikes to z~0.20) ---
CEN = Vector((0.005, 0.0, 0.148))   # head-ball center
RIM_Z = 0.155                       # crown lower rim: above the eyes, below the ears' midpoint

me = bpy.data.meshes.new("Hat")
bm = bmesh.new()

# ---------------------------------------------------------------- CROWN (dome)
R = 0.0535
SX, SY, SZ = 1.02, 0.93, 1.04       # hair wider front-back, squashed between ears, a touch tall
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=R)
for v in bm.verts:
    v.co = Vector((v.co.x * SX, v.co.y * SY, v.co.z * SZ)) + CEN
bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                       plane_co=Vector((0, 0, RIM_Z)), plane_no=Vector((0, 0, 1)),
                       clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
# relax icosphere facets into a smooth toy dome (keep the rim ring pinned)
dome = [v for v in bm.verts if v.co.z > RIM_Z + 0.008]
for _ in range(3):
    bmesh.ops.smooth_vert(bm, verts=dome, factor=0.5,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)

# ---------------------------------------------------------------- BILL (brim)
X0         = 0.048     # root x: tucked just under the crown front
Z0         = RIM_Z - 0.001
BILL_LEN   = 0.058     # forward reach
BILL_HALFW = 0.047     # half width at the root
DROOP      = 0.013     # tip drop below root (regular cap: fairly flat, slight curve)
SIDECURL   = 0.010     # side edges curl down (curved-bill profile)
ROOTHUG    = 0.020     # concave root so it hugs the round crown front
NT, NS = 7, 16

grid = []
for i in range(NT):
    t = i / NT
    hw = BILL_HALFW * math.sqrt(max(0.02, 1.0 - t * t))   # semi-ellipse outline
    row = []
    for j in range(NS + 1):
        s = -1.0 + 2.0 * j / NS
        x = X0 + BILL_LEN * t - ROOTHUG * (1.0 - t) * (s * s)
        y = s * hw
        z = Z0 - DROOP * (t ** 1.4) - SIDECURL * (s * s) * t
        row.append(bm.verts.new((x, y, z)))
    grid.append(row)
tip = bm.verts.new((X0 + BILL_LEN, 0.0, Z0 - DROOP))       # rounded tip
for i in range(NT - 1):
    for j in range(NS):
        bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
for j in range(NS):
    bm.faces.new((grid[NT - 1][j], grid[NT - 1][j + 1], tip))
billv = [v for row in grid for v in row] + [tip]
for _ in range(2):
    bmesh.ops.smooth_vert(bm, verts=billv, factor=0.3,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)

# ---------------------------------------------------------------- button on top
top = max(bm.verts, key=lambda v: v.co.z)
bs = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.0035)
for v in bs["verts"]:
    v.co = v.co + Vector((top.co.x, top.co.y, top.co.z + 0.001))

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
bm.to_mesh(me); bm.free()

hat = bpy.data.objects.new("Hat", me)
bpy.context.scene.collection.objects.link(hat)
sol = hat.modifiers.new("sol", "SOLIDIFY"); sol.thickness = 0.0030; sol.offset = 1.0
bpy.ops.object.select_all(action="DESELECT")
hat.select_set(True); bpy.context.view_layer.objects.active = hat
bpy.ops.object.modifier_apply(modifier="sol")
mat = bpy.data.materials.new("HatMat"); mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.16, 0.28, 0.52, 1.0)   # ball-cap blue
bsdf.inputs["Roughness"].default_value = 0.8
me.materials.append(mat)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.scene.cursor.location = head_bone_world
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.select_all(action="DESELECT")
hat.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE"); rig.data.bones.active = rig.data.bones["Head"]
bpy.ops.object.parent_set(type="BONE", keep_transform=True); bpy.ops.object.mode_set(mode="OBJECT")
me.calc_loop_triangles()
print(f"cap: {len(me.vertices)} verts, {len(me.loop_triangles)} tris")
bpy.ops.wm.save_as_mainfile(filepath=C.wip("hat"))
bpy.ops.object.select_all(action="DESELECT")
hat.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = hat
out = f"{C.COSDIR}/hat/base-v1.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True)
print("exported", out)
