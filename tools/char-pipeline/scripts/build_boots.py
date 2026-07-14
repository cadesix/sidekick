"""Boots (rigid, shoes slot, two meshes) -> cosmetics/shoes/boots-v1.glb.
Tall shafts: foot + toe + lower-calf surface, cut at mid-calf, slight flat sole.
Shoe_L -> L_Calf, Shoe_R -> R_Calf, shared material.
"""
import bpy, bmesh, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

BOOT_TOP = 0.034; OFFSET = 0.0032; SOLE_Z = 0.0015

body, rig = C.load_master()

def build(side):
    sgn = 1 if side == "L" else -1
    sh = C.dup_geo(body, f"Shoe_{side}",
                   lambda c: c.z < BOOT_TOP + 0.006 and c.y * sgn > 0.004)
    C.cut(sh, (0, 0, BOOT_TOP), (0, 0, 1), clear_outer=True)

    def sole(bm):
        for v in bm.verts:
            if v.co.z < 0.004:
                v.co.z = SOLE_Z

    C.offset_loosen(sh, OFFSET, edit=sole)
    # de-toe (same as sneakers): smooth toe box instead of inherited toe bumps —
    # plan-outline pass keeps the flat sole, front-cap pass + reinflate rounds
    # the knuckles while keeping clearance over the foot.
    xs = [(sh.matrix_world @ v.co).x for v in sh.data.vertices]
    toe_x = min(xs) + 0.45 * (max(xs) - min(xs))
    C.region_smooth(sh, lambda c: c.z < 0.0065, iters=25, axes=(True, True, False))
    C.region_smooth(sh, lambda c: 0.004 < c.z < 0.015 and c.x > toe_x,
                    iters=18, reinflate=0.0012)
    C.decimate(sh, 420)
    C.boundary_finish(sh, [("z", BOOT_TOP)], relax=10)
    C.solidify(sh, 0.0024)
    C.strip_skin(sh)
    C.set_material(sh, "ShoeMat", (0.35, 0.20, 0.10), 0.75)   # leather brown default
    C.smart_uv(sh)
    C.rigid_parent(sh, rig, f"{side}_Calf")
    return sh

sL, sR = build("L"), build("R")
C.export([sL, sR], rig, f"{C.COSDIR}/shoes/boots-v1.glb", wip=C.wip("boots"))
