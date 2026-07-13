"""Pose-verify a fixed rig with LOCAL rotations (never world-matrix surgery):
- contralateral test: rotating one arm must not move the other arm's verts
- full stress pose (upperarms down 65, forearms 20, head yaw 30) + renders
- export-contract checklist

Usage: blender --background --python pose_verify.py -- <blend> <renders_dir>
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
blend, outdir = argv[0], argv[1]
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=blend)
rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
mesh = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]

def eval_verts():
    dg = bpy.context.evaluated_depsgraph_get()
    ob = mesh.evaluated_get(dg)
    return [mesh.matrix_world @ v.co for v in ob.data.vertices]

def clear_pose():
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()

def set_arm(side, up_deg, fore_deg, sign_axis):
    sign, axis = sign_axis
    rot = [0.0, 0.0, 0.0]
    rot[axis] = math.radians(sign * up_deg)
    rig.pose.bones[f"{side}_Upperarm"].rotation_euler = rot
    rot2 = [0.0, 0.0, 0.0]
    rot2[axis] = math.radians(sign * fore_deg)
    rig.pose.bones[f"{side}_Forearm"].rotation_euler = rot2
    bpy.context.view_layer.update()

clear_pose()
rest = eval_verts()
paw = {s: [i for i, p in enumerate(rest) if (p.y > 0.045 if s == "L" else p.y < -0.045)]
       for s in ("L", "R")}
print(f"arm-region verts: L={len(paw['L'])} R={len(paw['R'])}")

# pick the rotation sign that lowers the hand
signs = {}
for side in ("L", "R"):
    hand_rest_z = sum(rest[i].z for i in paw[side]) / len(paw[side])
    best = None
    for axis in (0, 2):
        for sign in (1, -1):
            clear_pose()
            set_arm(side, 65, 0, (sign, axis))
            z = sum(eval_verts()[i].z for i in paw[side]) / len(paw[side])
            if z < hand_rest_z and (best is None or z < best[1]):
                best = ((sign, axis), z)
    assert best, f"no rotation lowers the {side} hand"
    signs[side] = best[0]
    clear_pose()
print(f"down-rotation signs: {signs}")

# --- contralateral test: pose ONE arm, the other side must not move ---
print("--- contralateral isolation")
ok = True
for mover in ("L", "R"):
    other = "R" if mover == "L" else "L"
    clear_pose()
    set_arm(mover, 65, 20, signs[mover])
    now = eval_verts()
    moved = max((now[i] - rest[i]).length for i in paw[mover])
    leaked = max((now[i] - rest[i]).length for i in paw[other])
    verdict = "PASS" if (leaked < 0.002 and moved > 0.03) else "FAIL"
    if verdict == "FAIL":
        ok = False
    print(f"  rotate {mover} arm: own side moved {moved:.4f}, "
          f"{other} side leaked {leaked:.5f}  [{verdict}]")

# --- full stress pose + renders ---
clear_pose()
for side in ("L", "R"):
    set_arm(side, 65, 20, signs[side])
rig.pose.bones["Head"].rotation_euler = (0, math.radians(30), 0)  # yaw about bone axis
bpy.context.view_layer.update()

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x, scene.render.resolution_y = 900, 1100

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def shot(name, pos, target, lens=50):
    cam.location = pos
    cam_data.lens = lens
    d = (Vector(target) - Vector(pos)).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(outdir, name)
    bpy.ops.render.render(write_still=True)
    print("  rendered", name)

shot("pose_front.png", (0.55, 0, 0.10), (0, 0, 0.10))
shot("pose_back.png", (-0.55, 0, 0.10), (0, 0, 0.10))
shot("pose_34.png", (0.40, -0.40, 0.16), (0, 0, 0.09))
shot("pose_upper_close.png", (0.30, 0, 0.11), (0, 0, 0.10), lens=80)  # armpits + neck/skirt
shot("pose_paws_close.png", (0.30, 0, 0.05), (0, 0, 0.055), lens=80)  # paw endpoints

# --- export contract checklist ---
print("--- contract checklist")
need = {"Waist", "Spine01", "Spine02", "NeckTwist01", "NeckTwist02", "Head"} | {
    f"{s}_{b}" for s in ("L", "R") for b in
    ("Clavicle", "Upperarm", "UpperarmTwist01", "UpperarmTwist02",
     "Forearm", "ForearmTwist01", "ForearmTwist02", "Hand")}
names = {b.name for b in rig.data.bones}
clear_pose()
pts = eval_verts()
z0 = min(p.z for p in pts); z1 = max(p.z for p in pts)
face_polys = [p for p in mesh.data.polygons
              if mesh.data.materials[p.material_index].name == "FaceSprite"]
fn = sum((mesh.matrix_world.to_3x3() @ p.normal for p in face_polys), Vector()) / len(face_polys)
checks = [
    ("required bone names present", need <= names, f"missing: {sorted(need - names)}"),
    ("bone count 41", len(rig.data.bones) == 41, str(len(rig.data.bones))),
    ("feet at y=0 (world z)", abs(z0) < 1e-3, f"{z0:.4f}"),
    ("height ~0.2", abs((z1 - z0) - 0.2) < 5e-3, f"{z1 - z0:.4f}"),
    ("facing +X (FaceSprite normal)", fn.normalized().x > 0.8, f"({fn.normalized().x:.2f})"),
    ("FaceSprite own material slot", len(mesh.data.materials) == 2, str(len(mesh.data.materials))),
    ("tri budget (<=35k)", 25000 <= len(mesh.data.polygons) <= 35000, str(len(mesh.data.polygons))),
    ("single mesh + single armature", len([o for o in scene.objects if o.type == "MESH"]) == 1
     and len([o for o in scene.objects if o.type == "ARMATURE"]) == 1, ""),
    ("max 4 influences", max(len(v.groups) for v in mesh.data.vertices) <= 4,
     str(max(len(v.groups) for v in mesh.data.vertices))),
]
for label, passed, detail in checks:
    print(f"  [{'PASS' if passed else 'FAIL'}] {label} {detail}")
print("CONTRALATERAL:", "PASS" if ok else "FAIL")
