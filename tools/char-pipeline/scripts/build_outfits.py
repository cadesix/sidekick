"""Build the outfit-kit part library in one Blender session.
  $B --background --python tools/char-pipeline/scripts/build_outfits.py
Bodies/hoods conform to the real mesh; features seat on it. Colors here are just
the preview color — the app recolors each part via its manifest variant, so one
body mesh + one hood-per-ear-style serves the whole roster.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C
import outfitlib as O

D = f"{C.COSDIR}/onesie"

# shared body suit (recolored per outfit)
O.build_body((0.40, 0.50, 0.55), f"{D}/body-v1.glb")

# hoods: head-conforming shell + per-animal features (seated on the surface)
O.build_hood((0.50, 0.52, 0.56), f"{D}/plain-hood-v1.glb", "PlainHood")
O.build_hood((0.56, 0.59, 0.63), f"{D}/cat-hood-v1.glb", "CatHood", feature=O.cat_ears)
O.build_hood((0.78, 0.60, 0.36), f"{D}/dog-hood-v1.glb", "DogHood", feature=O.dog_ears)
O.build_hood((0.93, 0.94, 0.93), f"{D}/bunny-hood-v1.glb", "BunnyHood", feature=O.bunny_ears)
O.build_hood((0.54, 0.35, 0.20), f"{D}/bear-hood-v1.glb", "BearHood", feature=O.bear_snout)
O.build_hood((0.44, 0.59, 0.72), f"{D}/shark-hood-v1.glb", "SharkHood", feature=O.shark_fin)
O.build_hood((0.76, 0.19, 0.16), f"{D}/devil-hood-v1.glb", "DevilHood", feature=O.devil_horns)

# standalone prop parts
O.build_nose((0.22, 0.18, 0.16), f"{D}/nose-v1.glb")
O.build_frog_eyes(f"{D}/frog-eyes-v1.glb")
O.build_antenna((0.66, 0.70, 0.75), f"{D}/antenna-v1.glb")
O.build_helmet(f"{D}/helmet-v1.glb")
O.build_chest_panel((0.66, 0.70, 0.75), f"{D}/chest-panel-v1.glb")

print("ALL OUTFIT PARTS BUILT")
