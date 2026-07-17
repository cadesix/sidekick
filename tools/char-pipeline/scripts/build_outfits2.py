import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C, outfitlib as O
D = f"{C.COSDIR}/onesie"
O.build_body((0.40,0.50,0.55), f"{D}/body-v1.glb")  # rebuild body with the collar fix
O.build_halo(f"{D}/halo-v1.glb")
O.build_wings(f"{D}/wings-v1.glb")
O.build_toque(f"{D}/toque-v1.glb")
O.build_headband((0.72,0.16,0.14), f"{D}/headband-v1.glb")
O.build_bee_antennae(f"{D}/bee-antennae-v1.glb")
print("WAVE 2 BUILT")
