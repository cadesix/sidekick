"""Render the character (v9) with the exported phone GLB: hand closeup + full front."""
import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C
from mathutils import Vector, Euler

TAG = os.environ.get("PHTAG", "phone1")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=C.CHAR_GLB)
bpy.ops.import_scene.gltf(filepath=f"{C.COSDIR}/phone/base-v1.glb")

scn = bpy.context.scene
scn.render.engine = "BLENDER_EEVEE_NEXT"
scn.render.resolution_x = 780; scn.render.resolution_y = 800
world = bpy.data.worlds.new("W"); scn.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.72, 0.75, 0.78, 1)

def add_sun(rot, energy):
    l = bpy.data.lights.new("S", "SUN"); l.energy = energy
    o = bpy.data.objects.new("S", l); o.rotation_euler = Euler([math.radians(a) for a in rot])
    scn.collection.objects.link(o)
add_sun((55, 15, 30), 3.0); add_sun((70, -30, -120), 1.2)

cam_data = bpy.data.cameras.new("C"); cam_data.lens = 70
cam = bpy.data.objects.new("C", cam_data); scn.collection.objects.link(cam); scn.camera = cam

def look_at(obj, tgt):
    d = (obj.location - tgt); obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()

HAND = Vector((0.012, -0.082, 0.093))
VIEWS = {
    "hand":      (Vector((0.16, -0.14, 0.115)), HAND),          # 3/4 closeup on right hand
    "hand_top":  (Vector((0.06, -0.09, 0.24)),  HAND),          # from above (screen side-ish)
    "front":     (Vector((0.65, 0.0, 0.14)), Vector((0, 0, 0.11))),  # full body
}
os.makedirs(os.path.join(C.PIPE, "renders"), exist_ok=True)
for name, (pos, tgt) in VIEWS.items():
    cam.location = pos; look_at(cam, tgt)
    scn.render.filepath = os.path.join(C.PIPE, "renders", f"{TAG}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", scn.render.filepath)
