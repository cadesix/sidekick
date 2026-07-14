"""Sneakers (rigid, shoes slot, two meshes) -> cosmetics/shoes/sneakers-v1.glb.
Shoe shells with a chunky flared FLAT sole (reads sneaker by silhouette).
Shoe_L -> L_Calf, Shoe_R -> R_Calf, shared SneakerMat.
"""
import bpy, bmesh, math, sys
from mathutils import Vector
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

SHOE_TOP = 0.022; OFFSET = 0.0030; SOLE_Z = 0.0015

body, rig = C.load_master()
mat_done = []

def build(side):
    sgn = 1 if side == "L" else -1
    sh = C.dup_geo(body, f"Shoe_{side}",
                   lambda c: c.z < SHOE_TOP + 0.006 and c.y * sgn > 0.004)

    def sole(bm):
        # foot's horizontal center for the flare direction
        vs = [v for v in bm.verts]
        c = sum((v.co for v in vs), Vector()) / len(vs)
        for v in bm.verts:
            if v.co.z < 0.010:
                d = Vector((v.co.x - c.x, v.co.y - c.y, 0))
                d = d.normalized() if d.length > 1e-6 else Vector((1, 0, 0))
                v.co += d * (0.0028 * (1.0 - v.co.z / 0.010))   # flare out toward the ground
            if v.co.z < 0.0045:
                v.co.z = SOLE_Z                                  # flat sole bottom

    C.offset_loosen(sh, OFFSET, edit=sole)
    # de-toe: a normal sneaker has a smooth toe box, not the character's toe
    # bumps the duplicated foot surface inherits. Round the plan outline near
    # the sole (keep z so the sole stays flat), then smooth the front-cap
    # knuckle bumps and re-inflate for foot clearance.
    C.region_smooth(sh, lambda c: c.z < 0.0065, iters=35, axes=(True, True, False),
                    reinflate=0.0025)
    # smooth the whole foot band hard (toe knuckles + instep creases), then
    # re-inflate PAST the foot's bump peaks so the toes can't poke through —
    # feathered to zero at the band top so it leaves no ledge under the rim
    ZT = SHOE_TOP - 0.003
    C.region_smooth(sh, lambda c: 0.0018 < c.z < ZT, iters=30, factor=0.8,
                    reinflate=0.0038,
                    reinflate_scale=lambda c: (ZT - c.z) / 0.010)
    C.decimate(sh, 380)
    # exact rim LAST: bisect after decimate gives a clean straight edge loop
    # (cutting first leaves decimate free to re-jag the boundary into spikes)
    C.cut(sh, (0, 0, SHOE_TOP), (0, 0, 1), clear_outer=True)
    C.boundary_finish(sh, [("z", SHOE_TOP)], relax=8)
    C.solidify(sh, 0.0022)
    C.strip_skin(sh)
    C.set_material(sh, "ShoeMat", (0.92, 0.92, 0.90), 0.55)   # classic white default
    C.smart_uv(sh)
    C.rigid_parent(sh, rig, f"{side}_Calf")
    return sh

sL, sR = build("L"), build("R")
C.export([sL, sR], rig, f"{C.COSDIR}/shoes/sneakers-v1.glb", wip=C.wip("sneakers"))
