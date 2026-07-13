"""Phone prop, parented to the R_Hand bone (rigid, not skinned).
Per public/3d-assets/phone-spec.md:
  - rounded-rectangle slab (PhoneBody) + separate slightly-proud inset screen
    (PhoneScreen), two meshes / two own materials, both children of R_Hand.
  - raw dims ~0.030 x 0.014 x 0.0024 (runtime ~0.15 tall on the 1.0 character).
  - long axis along the hand (bone Y), screen normal out the palm side (bone Z,
    palms-forward bind), back face resting just off the palm surface.
  - origin = grip point (palm contact), parent_set BONE keep_transform.
"""
import bpy, bmesh, math
from mathutils import Vector
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

bpy.ops.wm.open_mainfile(filepath=C.MASTER)
rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
bone = rig.data.bones["R_Hand"]
rot = (rig.matrix_world @ bone.matrix_local).to_3x3()
Xl = Vector(rot.col[0]).normalized()   # across the hand (width axis)
Yl = Vector(rot.col[1]).normalized()   # along the fingers (long axis)
Zl = Vector(rot.col[2]).normalized()   # out the palm (screen normal)

# --- palm surface: hand-dominated body verts, furthest along the palm normal ---
body = max((o for o in bpy.context.scene.objects if o.type == "MESH"),
           key=lambda o: len(o.data.vertices))
gi = body.vertex_groups.find("R_Hand")
hv = []
for v in body.data.vertices:
    for g in v.groups:
        if g.group == gi and g.weight > 0.5:
            hv.append(body.matrix_world @ v.co); break
cen = sum(hv, Vector()) / len(hv)
d_palm = max((p - cen).dot(Zl) for p in hv)
palm_pt = cen + Zl * d_palm                      # palm contact point (grip)

# --- phone dims (raw units; character is ~0.20 tall) ---
W, H, T = 0.014, 0.030, 0.0024
GAP = 0.0006                                     # air between palm and phone back
center = palm_pt + Zl * (GAP + T / 2.0)

def rounded_rect(w, h, r, seg=4):
    """Outline points (x,y) of a w x h rounded rect, CCW."""
    cx, cy = w / 2 - r, h / 2 - r
    pts = []
    corners = [(cx, cy, 0.0), (-cx, cy, 90.0), (-cx, -cy, 180.0), (cx, -cy, 270.0)]
    for px, py, a0 in corners:
        for k in range(seg + 1):
            a = math.radians(a0 + 90.0 * k / seg)
            pts.append((px + r * math.cos(a), py + r * math.sin(a)))
    return pts

def make_slab(name, w, h, r, z0, z1):
    """Closed rounded-rect slab spanning local z0..z1, placed into world space."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    outline = rounded_rect(w, h, r)
    lo = [bm.verts.new(center + Xl * x + Yl * y + Zl * z0) for x, y in outline]
    hi = [bm.verts.new(center + Xl * x + Yl * y + Zl * z1) for x, y in outline]
    n = len(outline)
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bm.faces.new(lo)   # back cap
    bm.faces.new(list(reversed(hi)))   # front cap
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = False                # crisp slab edges — it's a phone, not a blob
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

phone = make_slab("Phone", W, H, 0.0032, 0.0, T)
# screen: inset border, front surface a hair proud of the body face (no z-fight)
screen = make_slab("PhoneScreen", W - 0.0026, H - 0.0026, 0.0022, T - 0.0002, T + 0.0002)

mb = bpy.data.materials.new("PhoneBody"); mb.use_nodes = True
b = next(n for n in mb.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value = (0.012, 0.012, 0.014, 1.0)   # ~#1c1c1e matte
b.inputs["Roughness"].default_value = 0.85
phone.data.materials.append(mb)
ms = bpy.data.materials.new("PhoneScreen"); ms.use_nodes = True
s = next(n for n in ms.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
s.inputs["Base Color"].default_value = (0.010, 0.013, 0.022, 1.0)   # dark glass
s.inputs["Roughness"].default_value = 0.15
screen.data.materials.append(ms)

for ob in (phone, screen):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")

# origin = grip point (palm contact), then rigid-parent both to R_Hand
bpy.context.scene.cursor.location = palm_pt
bpy.ops.object.select_all(action="DESELECT")
phone.select_set(True); screen.select_set(True)
bpy.context.view_layer.objects.active = phone
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE"); rig.data.bones.active = rig.data.bones["R_Hand"]
bpy.ops.object.parent_set(type="BONE", keep_transform=True)
bpy.ops.object.mode_set(mode="OBJECT")

for ob in (phone, screen):
    ob.data.calc_loop_triangles()
    print(f"{ob.name}: {len(ob.data.vertices)} verts, {len(ob.data.loop_triangles)} tris")
print(f"palm_pt={tuple(round(c,4) for c in palm_pt)} center={tuple(round(c,4) for c in center)}")
bpy.ops.wm.save_as_mainfile(filepath=C.wip("phone"))
bpy.ops.object.select_all(action="DESELECT")
phone.select_set(True); screen.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = phone
out = f"{C.COSDIR}/phone/base-v1.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True)
print("exported", out)
