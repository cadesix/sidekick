"""Render every shop item on the character (one at a time), 2 views each."""
import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C
from mathutils import Vector, Euler

COS = C.COSDIR
HEAD = Vector((0.0, 0.0, 0.155))
FACE = Vector((0.04, 0.0, 0.148))
FEET = Vector((0.01, 0.0, 0.022))
BODY = Vector((0.0, 0.0, 0.075))
BACK = Vector((-0.02, 0.0, 0.065))

JOBS = [
    ("hoodie",   f"{COS}/shirt/hoodie-v1.glb",    [((0.55, -0.25, 0.14), BODY), ((0.3, 0.5, 0.13), BODY)]),
    ("shorts",   f"{COS}/pants/shorts-v1.glb",    [((0.55, -0.25, 0.10), Vector((0, 0, 0.045))), ((0.0, 0.6, 0.08), Vector((0, 0, 0.04)))]),
    ("beanie",   f"{COS}/hat/beanie-v1.glb",      [((0.6, 0.0, 0.17), HEAD), ((0.35, -0.45, 0.22), HEAD)]),
    ("bucket",   f"{COS}/hat/bucket-v1.glb",      [((0.6, 0.0, 0.17), HEAD), ((0.35, -0.45, 0.22), HEAD)]),
    ("wizard",   f"{COS}/hat/wizard-v1.glb",      [((0.62, 0.0, 0.19), Vector((0, 0, 0.18))), ((0.35, -0.5, 0.24), Vector((0, 0, 0.18)))]),
    ("crown",    f"{COS}/hat/crown-v1.glb",       [((0.6, 0.0, 0.18), HEAD), ((0.35, -0.45, 0.23), HEAD)]),
    ("sneakers", f"{COS}/shoes/sneakers-v1.glb",  [((0.5, -0.22, 0.07), FEET), ((0.05, 0.55, 0.05), FEET)]),
    ("boots",    f"{COS}/shoes/boots-v1.glb",     [((0.5, -0.22, 0.07), FEET), ((0.05, 0.55, 0.05), FEET)]),
    ("glasses",  f"{COS}/glasses/base-v1.glb",    [((0.42, 0.0, 0.16), FACE), ((0.3, -0.28, 0.18), FACE)]),
    ("backpack", f"{COS}/back/backpack-v1.glb",   [((-0.55, -0.3, 0.16), BACK), ((0.02, -0.6, 0.09), BACK)]),
]

only = os.environ.get("ONLY")
if only:
    keep = set(only.split(","))
    JOBS = [j for j in JOBS if j[0] in keep]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=C.CHAR_GLB)
base_objs = set(bpy.data.objects)

scn = bpy.context.scene
scn.render.engine = "BLENDER_EEVEE_NEXT"
scn.render.resolution_x = 720; scn.render.resolution_y = 720
world = bpy.data.worlds.new("W"); scn.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.72, 0.75, 0.78, 1)

def add_sun(rot, energy):
    l = bpy.data.lights.new("S", "SUN"); l.energy = energy
    o = bpy.data.objects.new("S", l); o.rotation_euler = Euler([math.radians(a) for a in rot])
    scn.collection.objects.link(o)
add_sun((55, 15, 30), 3.0); add_sun((70, -30, -120), 1.2)
base_objs = set(bpy.data.objects)

cam_data = bpy.data.cameras.new("C"); cam_data.lens = 70
cam = bpy.data.objects.new("C", cam_data)
scn.collection.objects.link(cam); scn.camera = cam
base_objs.add(cam)

def look_at(obj, tgt):
    d = (obj.location - Vector(tgt)); obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()

os.makedirs(os.path.join(C.PIPE, "renders", "shop"), exist_ok=True)
for name, glb, views in JOBS:
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [o for o in bpy.data.objects if o not in base_objs]
    for i, (pos, tgt) in enumerate(views):
        cam.location = Vector(pos); look_at(cam, tgt)
        scn.render.filepath = os.path.join(C.PIPE, "renders", "shop", f"{name}_{i}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", scn.render.filepath)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
