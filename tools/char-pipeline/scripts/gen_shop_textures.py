"""Generate variant webp textures for the shop items (256x256, solid + simple
patterns) using Blender's image API (no PIL needed). sRGB colors as 0-1 floats."""
import bpy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C
import numpy as np

COS = C.COSDIR
S = 256

def save(slot, name, arr):
    img = bpy.data.images.new(name, S, S, alpha=False)
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = f"{COS}/{slot}/{name}.webp"
    img.file_format = "WEBP"
    os.makedirs(os.path.dirname(img.filepath_raw), exist_ok=True)
    img.save()
    print("wrote", img.filepath_raw)

def solid(rgb):
    a = np.empty((S, S, 4), dtype=np.float32)
    a[..., 0], a[..., 1], a[..., 2], a[..., 3] = *rgb, 1.0
    return a

def speckle(rgb, amt=0.06, seed=7):
    rng = np.random.default_rng(seed)
    a = solid(rgb)
    n = rng.normal(0, amt, (S, S, 1)).astype(np.float32)
    a[..., :3] = np.clip(a[..., :3] + n, 0, 1)
    return a

def stars(rgb, star_rgb=(0.95, 0.92, 0.75), n=90, seed=11):
    rng = np.random.default_rng(seed)
    a = solid(rgb)
    for _ in range(n):
        x, y = rng.integers(2, S - 2, 2)
        a[y, x, :3] = star_rgb
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a[y + dy, x + dx, :3] = np.mean([a[y + dy, x + dx, :3], star_rgb], axis=0)
    return a

# slot, name, array
TEX = [
    ("shirt", "heather",  speckle((0.62, 0.62, 0.65))),
    ("shirt", "navy-h",   solid((0.13, 0.17, 0.30))),
    ("shirt", "crimson",  solid((0.55, 0.12, 0.14))),
    ("pants", "gym-navy", solid((0.16, 0.20, 0.34))),
    ("pants", "gym-red",  solid((0.60, 0.14, 0.13))),
    ("pants", "gym-black", solid((0.10, 0.10, 0.11))),
    ("hat", "charcoal",   speckle((0.16, 0.16, 0.18), amt=0.04, seed=3)),
    ("hat", "tangerine",  solid((0.85, 0.42, 0.10))),
    ("hat", "teal",       solid((0.10, 0.42, 0.42))),
    ("hat", "sand",       solid((0.68, 0.62, 0.48))),
    ("hat", "night",      solid((0.12, 0.12, 0.15))),
    ("hat", "wiz-purple", solid((0.32, 0.18, 0.50))),
    ("hat", "wiz-night",  stars((0.10, 0.11, 0.25))),
    ("hat", "gold",       solid((0.87, 0.63, 0.18))),
    ("hat", "silver",     solid((0.75, 0.77, 0.80))),
    ("shoes", "snk-white", solid((0.93, 0.93, 0.91))),
    ("shoes", "snk-black", solid((0.12, 0.12, 0.13))),
    ("shoes", "snk-red",  solid((0.70, 0.16, 0.14))),
    ("shoes", "boot-brown", solid((0.38, 0.22, 0.11))),
    ("shoes", "boot-black", solid((0.11, 0.11, 0.12))),
    ("glasses", "black",  solid((0.05, 0.05, 0.06))),
    ("glasses", "white",  solid((0.92, 0.92, 0.92))),
    ("glasses", "pink",   solid((0.90, 0.45, 0.60))),
    ("back", "bp-red",    solid((0.64, 0.16, 0.14))),
    ("back", "bp-sky",    solid((0.32, 0.55, 0.78))),
    ("back", "bp-forest", solid((0.16, 0.38, 0.22))),
]
for slot, name, arr in TEX:
    save(slot, name, arr)
