"""Shorts (skinned, pants slot) -> cosmetics/pants/shorts-v1.glb.
Pants approach with the leg cut just above the knee (knee/L_Calf head z=0.0276).
"""
import bpy, sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

WAIST_TOP = 0.050; LEG_END = 0.030; OFFSET = 0.0026

body, rig = C.load_master()
sh = C.dup_region(body, "Pants",   # named Pants: same skinned slot mesh hook
                  exclude_sub=("Head", "Spine", "Clavicle", "Upperarm", "Forearm", "Hand", "Neck"))
C.cut(sh, (0, 0, WAIST_TOP), (0, 0, 1), clear_outer=True)
C.cut(sh, (0, 0, LEG_END), (0, 0, 1), clear_inner=True)
C.offset_loosen(sh, OFFSET)
C.decimate(sh, 520)
C.boundary_finish(sh, [("z", WAIST_TOP), ("z", LEG_END)])
C.solidify(sh, 0.0020)
C.set_material(sh, "PantsMat", (0.16, 0.20, 0.34), 0.8)   # gym navy default
C.smart_uv(sh)
C.finish_weights(sh)
C.export([sh], rig, f"{C.COSDIR}/pants/shorts-v1.glb", skinned=True,
         wip=C.wip("shorts"))
