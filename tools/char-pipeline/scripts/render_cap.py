"""Render the character (v9) with the exported hat GLB, 3 views, to renders/yellow2/."""
import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C
from mathutils import Vector, Euler

TAG = os.environ.get("CAPTAG", "cap7")
bpy.ops.wm.read_factory_settings(use_empty=True)

# character
bpy.ops.import_scene.gltf(filepath=C.CHAR_GLB)
# hat (already parented to Head in its own rig; import brings its armature too)
bpy.ops.import_scene.gltf(filepath=f"{C.COSDIR}/hat/base-v1.glb")

# simple studio light + camera rig
scn = bpy.context.scene
scn.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "Scene") else "BLENDER_EEVEE"
try:
    scn.render.engine = "BLENDER_EEVEE_NEXT"
except Exception:
    scn.render.engine = "BLENDER_EEVEE"
scn.render.resolution_x = 780; scn.render.resolution_y = 800
scn.render.film_transparent = False
world = bpy.data.worlds.new("W"); scn.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.72, 0.75, 0.78, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

for i, (rx, ry, rz, e) in enumerate([(60, 0, 0, 1.2), (75, 0, 45, 1.2)]):
    pass

def add_sun(rot, energy):
    l = bpy.data.lights.new("S", "SUN"); l.energy = energy
    o = bpy.data.objects.new("S", l); o.rotation_euler = Euler([math.radians(a) for a in rot])
    scn.collection.objects.link(o)
add_sun((55, 15, 30), 3.0); add_sun((70, -30, -120), 1.2)

cam_data = bpy.data.cameras.new("C"); cam_data.lens = 70
cam = bpy.data.objects.new("C", cam_data); scn.collection.objects.link(cam); scn.camera = cam

# target the head (~z 0.15 raw). aim camera at head height.
TARGET = Vector((0.0, 0.0, 0.15))
def look_at(obj, tgt):
    d = (obj.location - tgt); obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()

VIEWS = {
    "front": Vector((0.65, 0.0, 0.16)),
    "side":  Vector((0.0, -0.65, 0.16)),
    "top":   Vector((0.18, 0.0, 0.62)),
}
os.makedirs(os.path.join(C.PIPE, "renders"), exist_ok=True)
for name, pos in VIEWS.items():
    cam.location = pos; look_at(cam, TARGET)
    scn.render.filepath = os.path.join(C.PIPE, "renders", f"{TAG}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", scn.render.filepath)
