import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C, outfitlib as O
D = f"{C.COSDIR}/onesie"
O.build_enclosing_hood((0.56,0.59,0.63), f"{D}/pointy-hood-v1.glb", "PointyHood", ears="pointy")
O.build_enclosing_hood((0.78,0.60,0.36), f"{D}/floppy-hood-v1.glb", "FloppyHood", ears="floppy")
O.build_enclosing_hood((0.93,0.94,0.93), f"{D}/long-hood-v1.glb",   "LongHood",   ears="long")
O.build_enclosing_hood((0.42,0.75,0.27), f"{D}/plain-ovoid-hood-v1.glb", "PlainOvoid")
O.build_enclosing_hood((0.44,0.59,0.72), f"{D}/fin-hood-v1.glb",    "FinHood",    ears="fin")
O.build_enclosing_hood((0.76,0.19,0.16), f"{D}/horn-hood-v1.glb",   "HornHood",   ears="horns")
# mummy/ninja — tighter window (more wrapped)
O.build_enclosing_hood((0.90,0.88,0.82), f"{D}/wrapped-hood-v1.glb", "WrappedHood", yw=0.038, zlo=0.120, zhi=0.172, rx=0.058, ry=0.082, rz=0.060)
# robot — box
O.build_enclosing_hood((0.66,0.69,0.73), f"{D}/box-hood-v1.glb", "BoxHood", shape="box", yw=0.046, zlo=0.112, zhi=0.178, rx=0.058, ry=0.082, rz=0.060)
print("ENCLOSING HOODS REBUILT")
