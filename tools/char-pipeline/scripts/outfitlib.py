"""Reusable builders for OUTFIT kits — the proven conform-to-the-real-mesh
process from the finalized dino, generalized:

  • build_body()  : one shared onesie body suit (torso + sleeves-to-the-wrist +
                    legs-to-the-ankle). Duplicates the real body surface, so it
                    hugs the contour. Bare paws + feet. Colored per-variant in
                    the app, so ONE mesh serves every onesie.
  • build_hood()  : a head-CONFORMING shell (duplicates the real head surface),
                    face opened, with an optional feature callback (ears/crest/
                    horns/fin) that SEATS geometry on the true surface.
  • feature fns   : cat/dog/bunny ears, bear snout, shark fin, devil horns —
                    each ray-casts the mesh and plants geometry flush.
  • prop builders : nose, frog eyes, antenna, helmet, chest panel.

Every seated part uses coslib.surface_hit / seat helpers, never a guessed sphere.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coslib as C

CEN = Vector((0.005, 0.0, 0.148))       # head-ball center (ray origin)
HOOD_OFFSET = 0.0042


def _open():
    return C.load_master()


def _cone(bm, base, up, rx, ry, length, nseg=8):
    """Elliptical-base cone seated at `base` pointing along `up`. rx/ry squash it
    (rx across, ry front-back) for pointy ears; length is the height."""
    up = Vector(up).normalized()
    ref = Vector((1, 0, 0)) if abs(up.z) > 0.5 else Vector((0, 0, 1))
    u = up.cross(ref).normalized()
    w = up.cross(u).normalized()
    tip = Vector(base) + up * length
    ring = [bm.verts.new(Vector(base) + u * (rx * math.cos(2 * math.pi * k / nseg))
                         + w * (ry * math.sin(2 * math.pi * k / nseg))) for k in range(nseg)]
    apex = bm.verts.new(tip)
    for k in range(nseg):
        bm.faces.new((ring[k], ring[(k + 1) % nseg], apex))
    bm.faces.new(ring)
    return ring + [apex]


def _blob(bm, center, rx, ry, rz):
    """Squashed icosphere blob (snout/eye bulge)."""
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=2, radius=1.0)
    vmap = {}
    for v in tmp.verts:
        nv = bm.verts.new(Vector(center) + Vector((v.co.x * rx, v.co.y * ry, v.co.z * rz)))
        vmap[v] = nv
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


# ---------------- body suit (shared) ----------------

def build_body(color, out, name="OnesieBody"):
    body, rig = _open()
    mw = body.matrix_world; mwi = mw.inverted()
    NECK_Z, ANKLE_Z, WRIST_Y = 0.104, 0.014, 0.072  # collar higher, overlaps the hood
    OFFSET, TARGET_TRIS, THICK = 0.0038, 1600, 0.0024
    gi = {g.index: g.name for g in body.vertex_groups}
    fs_idx = list(body.data.materials).index(bpy.data.materials["FaceSprite"])

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    suit = bpy.context.view_layer.objects.active
    suit.name = name; suit.data.name = name
    me = suit.data

    def dom(poly):
        acc = {}
        for vi in poly.vertices:
            for g in me.vertices[vi].groups:
                acc[gi[g.group]] = acc.get(gi[g.group], 0) + g.weight
        return max(acc, key=acc.get) if acc else ""

    doom = {p.index for p in me.polygons
            if p.material_index == fs_idx or "Head" in dom(p) or not dom(p)}
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in doom], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

    # offset out + loosen the FULL surface (rims still attached — hands/feet/neck)
    bm.normal_update()
    for v in bm.verts:
        v.co = v.co + v.normal * OFFSET
    inner = [v for v in bm.verts if not any(len(e.link_faces) == 1 for e in v.link_edges)]
    for _ in range(2):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()

    # decimate BEFORE cutting the rims (cutting after gives clean straight edge
    # loops; cutting first lets decimate re-jag the boundary into spikes)
    dec = suit.modifiers.new("dec", "DECIMATE")
    me.calc_loop_triangles()
    dec.ratio = min(1.0, TARGET_TRIS / max(1, len(me.loop_triangles)))
    bpy.ops.object.select_all(action="DESELECT"); suit.select_set(True)
    bpy.context.view_layer.objects.active = suit
    bpy.ops.object.modifier_apply(modifier="dec")

    # NOW open the rims (neck / ankles / wrists) on the decimated mesh, then snap
    # + relax them into clean loops — this is what fixes the jagged collar.
    bm = bmesh.new(); bm.from_mesh(me)

    def cut(co, no, **kw):
        bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                               plane_co=mwi @ Vector(co), plane_no=mwi.to_3x3() @ Vector(no), **kw)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    cut((0, 0, NECK_Z), (0, 0, 1), clear_outer=True)
    cut((0, 0, ANKLE_Z), (0, 0, 1), clear_inner=True)
    cut((0, WRIST_Y, 0), (0, 1, 0), clear_outer=True)
    cut((0, -WRIST_Y, 0), (0, 1, 0), clear_inner=True)

    for v in bm.verts:
        if not any(len(e.link_faces) == 1 for e in v.link_edges):
            continue
        p = mw @ v.co
        if abs(p.z - NECK_Z) < 0.012:
            p.z = NECK_Z; v.co = mwi @ p
        elif abs(p.z - ANKLE_Z) < 0.010:
            p.z = ANKLE_Z; v.co = mwi @ p
        elif abs(abs(p.y) - WRIST_Y) < 0.010:
            p.y = math.copysign(WRIST_Y, p.y); v.co = mwi @ p
    for _ in range(22):
        bv = [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]
        np_ = {}
        for v in bv:
            nb = [e.other_vert(v) for e in v.link_edges if len(e.link_faces) == 1]
            if len(nb) == 2:
                np_[v] = v.co * 0.34 + (nb[0].co + nb[1].co) * 0.33
        for v, co in np_.items():
            v.co = co
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()

    sol = suit.modifiers.new("sol", "SOLIDIFY"); sol.thickness = THICK; sol.offset = -1.0; sol.use_rim = True
    bpy.ops.object.modifier_apply(modifier="sol")
    C.set_material(suit, name + "Mat", color, 0.6)
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    C.finish_weights(suit)
    me.calc_loop_triangles()
    print(f"{name}: {len(me.vertices)}v {len(me.loop_triangles)}t")
    bpy.ops.object.select_all(action="DESELECT")
    suit.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = suit
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True,
                              export_skins=True, export_yup=True, export_apply=False)
    print("exported", out)


# ---------------- head-conforming hood ----------------

def build_hood(color, out, name="Hood", feature=None, front_x=0.030, neck_z=0.095):
    body, rig = _open()
    ob = C.dup_region(body, name, keep=["Head"])
    C.strip_skin(ob)
    C.offset_loosen(ob, HOOD_OFFSET, loops=2)
    C.cut(ob, (0, 0, neck_z), (0, 0, 1), clear_inner=True)
    C.cut(ob, (front_x, 0, 0), (1, 0, 0), clear_outer=True)
    C.decimate(ob, 700)
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    if feature:
        feature(bm, body)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me); bm.free(); me.update()
    C.solidify(ob, 0.0026, offset=1.0)
    C.set_material(ob, name + "Mat", color, 0.6)
    C.smart_uv(ob)
    C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def _seat(body, d, offset=HOOD_OFFSET + 0.001):
    pt, nrm = C.surface_hit(body, CEN, Vector(d).normalized())
    if pt is None:
        return None, None
    return pt + nrm * offset, nrm


# ---- hood features (add into the hood bmesh, seated on the real surface) ----

def dino_crest(bm, body):
    for d, ln in [((0.35, 0, 0.94), 0.012), ((0.06, 0, 1.0), 0.018), ((-0.24, 0, 0.97), 0.022),
                  ((-0.54, 0, 0.84), 0.018), ((-0.76, 0, 0.62), 0.012)]:
        base, nrm = _seat(body, d)
        if base is None:
            continue
        up = (nrm * 0.5 + Vector((0, 0, 1)) * 0.5).normalized()
        C.seat_spike(bm, base, up, ln, 0.006, nseg=4)


def cat_ears(bm, body):
    for sgn in (1, -1):
        base, nrm = _seat(body, (0.02, sgn * 0.42, 0.90))
        if base is None:
            continue
        up = (nrm * 0.35 + Vector((0, sgn * 0.25, 1)) * 0.65).normalized()
        _cone(bm, base, up, 0.011, 0.007, 0.028, nseg=6)


def dog_ears(bm, body):
    for sgn in (1, -1):
        base, nrm = _seat(body, (0.0, sgn * 0.9, 0.28))
        if base is None:
            continue
        down = (Vector((0, sgn * 0.35, -1)) + nrm * 0.2).normalized()  # floppy, drooping
        _cone(bm, base, down, 0.014, 0.009, 0.040, nseg=6)


def bunny_ears(bm, body):
    for sgn in (1, -1):
        base, nrm = _seat(body, (0.05, sgn * 0.22, 0.97))
        if base is None:
            continue
        up = (Vector((0, sgn * 0.10, 1)) + nrm * 0.15).normalized()
        _cone(bm, base, up, 0.008, 0.005, 0.058, nseg=6)


def bear_snout(bm, body):
    base, nrm = _seat(body, (0.95, 0, -0.15), offset=HOOD_OFFSET - 0.002)
    if base is not None:
        _blob(bm, base + nrm * 0.006, 0.020, 0.016, 0.014)


def shark_fin(bm, body):
    # a single sail fin along the top ridge (y=0), front to back
    pts = []
    for d, h in [((0.30, 0, 0.95), 0.010), ((0.0, 0, 1.0), 0.028), ((-0.35, 0, 0.94), 0.024),
                 ((-0.62, 0, 0.78), 0.010)]:
        base, nrm = _seat(body, d)
        if base is None:
            continue
        up = (nrm * 0.3 + Vector((0, 0, 1)) * 0.7).normalized()
        pts.append((base, base + up * h))
    for (b0, t0), (b1, t1) in zip(pts, pts[1:]):
        for a, b, c in [(b0, b1, t1), (b0, t1, t0)]:
            for eps in (0.0022, -0.0022):  # give the sail a bit of thickness
                bm.faces.new((bm.verts.new(a + Vector((0, eps, 0))),
                              bm.verts.new(b + Vector((0, eps, 0))),
                              bm.verts.new(c + Vector((0, eps, 0)))))


def devil_horns(bm, body):
    for sgn in (1, -1):
        base, nrm = _seat(body, (0.55, sgn * 0.18, 0.72))
        if base is None:
            continue
        up = (nrm * 0.5 + Vector((0.2, sgn * 0.1, 1)) * 0.5).normalized()
        _cone(bm, base, up, 0.006, 0.006, 0.024, nseg=6)


# ---------------- standalone prop parts (own GLBs) ----------------

def build_nose(color, out, name="Nose"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    # aim well below the (app-raised) eye line so the nose sits on the snout,
    # between the eyes and the mouth
    base, nrm = C.surface_hit(body, CEN, Vector((0.90, 0, -0.34)).normalized())
    if base is None:
        base, nrm = Vector((0.050, 0, 0.132)), Vector((1, 0, 0))
    _blob(bm, base + nrm * 0.004, 0.009, 0.007, 0.006)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", color, 0.5)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_frog_eyes(out, name="FrogEyes"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    # bulges on top-front of the ENCLOSING ovoid (frog uses plain-ovoid hood)
    for sgn in (1, -1):
        _blob(bm, Vector((0.022, sgn * 0.034, 0.206)), 0.017, 0.017, 0.017)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", (0.92, 0.94, 0.86), 0.5)  # off-white
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_antenna(color, out, name="Antenna"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    base, nrm = C.surface_hit(body, CEN, Vector((0.0, 0, 1)).normalized())
    if base is None:
        base, nrm = Vector((0.005, 0, 0.20)), Vector((0, 0, 1))
    top = base + nrm * 0.028
    C.add_tube(bm, [base + nrm * 0.002, (base + top) * 0.5, top], 0.0016, nseg=6, taper_ends=False, cap=True)
    _blob(bm, top + nrm * 0.004, 0.006, 0.006, 0.006)  # ball on top
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", color, 0.4, metallic=0.6)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_helmet(out, name="Helmet"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.072)
    for v in bm.verts:
        v.co = Vector((v.co.x * 1.05, v.co.y, v.co.z * 1.02)) + CEN
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    # thin glassy shell
    m = C.set_material(ob, name + "Mat", (0.85, 0.92, 1.0), 0.05, metallic=0.0)
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Alpha"].default_value = 0.25
    m.blend_method = "BLEND"
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_chest_panel(color, out, name="ChestPanel"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    # a small rounded box on the front chest (chest front x ~ +0.015 at z 0.06-0.08)
    C.add_slab(bm, Vector((0.016, 0, 0.070)), Y, Z, X, 0.028, 0.024, 0.006, 0.006, scales=(1.0, 0.9))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", color, 0.5)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Spine01")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


# ---------------- wave 2 props ----------------

def build_halo(out, name="Halo"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    C0 = Vector((0.008, 0.0, 0.236)); R, r = 0.030, 0.0045; NU, NV = 26, 8
    rows = []
    for i in range(NU):
        a = 2 * math.pi * i / NU
        center = Vector((C0.x + R * math.cos(a), R * math.sin(a), C0.z))
        rad = Vector((math.cos(a), math.sin(a), 0))
        rows.append([bm.verts.new(center + rad * (r * math.cos(2 * math.pi * j / NV))
                     + Vector((0, 0, r * math.sin(2 * math.pi * j / NV)))) for j in range(NV)])
    for i in range(NU):
        A, B = rows[i], rows[(i + 1) % NU]
        for j in range(NV):
            bm.faces.new((A[j], A[(j + 1) % NV], B[(j + 1) % NV], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", (0.95, 0.82, 0.30), 0.3, metallic=0.6)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_wings(out, name="Wings", color=(0.95, 0.96, 0.98), span=0.078, thick=0.003):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    base = Vector((-0.026, 0.0, 0.078))
    for sgn in (1, -1):
        outl = [base + Vector((0, sgn * 0.010, -0.008)),
                base + Vector((-0.010, sgn * span * 0.55, 0.032)),
                base + Vector((-0.016, sgn * span, 0.058)),
                base + Vector((-0.010, sgn * span * 0.82, 0.018)),
                base + Vector((-0.006, sgn * span * 0.48, -0.012))]
        top = [bm.verts.new(p + Vector((thick, 0, 0))) for p in outl]
        bot = [bm.verts.new(p - Vector((thick, 0, 0))) for p in outl]
        n = len(outl)
        bm.faces.new(top if sgn > 0 else list(reversed(top)))
        bm.faces.new(list(reversed(bot)) if sgn > 0 else bot)
        for i in range(n):
            bm.faces.new((top[i], top[(i + 1) % n], bot[(i + 1) % n], bot[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", color, 0.6)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Spine01")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_toque(out, name="Toque"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    C.add_lathe(bm, [(0.044, 0.184, None), (0.045, 0.206, None)], nseg=24, sy=0.95, cx=0.005)
    _blob(bm, Vector((0.005, 0, 0.226)), 0.052, 0.050, 0.030)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", (0.96, 0.96, 0.94), 0.7)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_headband(color, out, name="Headband"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    C.add_lathe(bm, [(0.050, 0.150, None), (0.051, 0.167, None)], nseg=24, sy=0.94, cx=0.005)
    for dz in (0.004, -0.006):
        path = [Vector((-0.046, 0.004, 0.158 + dz)), Vector((-0.060, 0.010, 0.150 + dz)),
                Vector((-0.074, 0.014, 0.138 + dz))]
        C.add_tube(bm, path, 0.0035, nseg=5, taper_ends=False, cap=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", color, 0.7)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


def build_bee_antennae(out, name="BeeAntennae"):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    for sgn in (1, -1):
        base, nrm = C.surface_hit(body, CEN, Vector((0.18, sgn * 0.16, 0.97)).normalized())
        if base is None:
            continue
        up = Vector((0.22, sgn * 0.14, 1)).normalized()
        top = base + up * 0.030
        C.add_tube(bm, [base + nrm * 0.003, (base + top) * 0.5, top], 0.0013, nseg=5, taper_ends=False, cap=True)
        _blob(bm, top, 0.0055, 0.0055, 0.0055)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.set_material(ob, name + "Mat", (0.18, 0.15, 0.12), 0.5)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))


# ---------------- enclosing head shells (HIDE the base ears) ----------------
# For outfits whose head should be a NEW shape (fox/cat/mummy/robot/devil…): a
# smooth ovoid (or box) sized to swallow the base head + its big ears, so the
# built-in ears don't poke through. The outfit's own ears sit on THIS shell.

def _ovoid_ears(bm, style, C0, rx, ry, rz):
    topz = C0.z + rz
    if style == "pointy":       # cat / fox
        for sgn in (1, -1):
            base = Vector((C0.x + 0.004, sgn * 0.030, topz - 0.008))
            _cone(bm, base, Vector((0.10, sgn * 0.30, 1)).normalized(), 0.013, 0.008, 0.030, nseg=6)
    elif style == "long":       # bunny
        for sgn in (1, -1):
            base = Vector((C0.x + 0.008, sgn * 0.020, topz - 0.004))
            _cone(bm, base, Vector((0.02, sgn * 0.08, 1)).normalized(), 0.009, 0.006, 0.062, nseg=6)
    elif style == "floppy":     # dog
        for sgn in (1, -1):
            base = Vector((C0.x - 0.004, sgn * (ry - 0.004), C0.z + rz * 0.30))
            _cone(bm, base, Vector((0, sgn * 0.35, -1)).normalized(), 0.016, 0.010, 0.044, nseg=6)
    elif style == "horns":      # devil
        for sgn in (1, -1):
            base = Vector((C0.x + rx * 0.55, sgn * 0.022, topz - 0.010))
            _cone(bm, base, Vector((0.30, sgn * 0.12, 1)).normalized(), 0.007, 0.007, 0.026, nseg=6)
    elif style == "fin":        # shark — single sail along the top ridge
        pts = []
        for xf, h in [(0.45, 0.010), (0.10, 0.026), (-0.30, 0.024), (-0.62, 0.010)]:
            b = Vector((C0.x + rx * xf, 0.0, topz - 0.004))
            pts.append((b, b + Vector((0, 0, h))))
        for (b0, t0), (b1, t1) in zip(pts, pts[1:]):
            for a, b, c in [(b0, b1, t1), (b0, t1, t0)]:
                for eps in (0.0022, -0.0022):
                    bm.faces.new((bm.verts.new(a + Vector((0, eps, 0))),
                                  bm.verts.new(b + Vector((0, eps, 0))),
                                  bm.verts.new(c + Vector((0, eps, 0)))))


def build_enclosing_hood(color, out, name, shape="ovoid", ears=None, front_x=0.028,
                         yw=0.044, zlo=0.110, zhi=0.182, rx=0.056, ry=0.080, rz=0.058,
                         cz=0.150, neck_z=0.096, round_box=0.013):
    body, rig = _open()
    ob = C.bm_new_obj(name); bm = bmesh.new()
    C0 = Vector((0.005, 0.0, cz))
    if shape == "box":
        bmesh.ops.create_cube(bm, size=2.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * rx, v.co.y * ry, v.co.z * rz)) + C0
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=round_box, segments=3,
                        affect="EDGES", clamp_overlap=True)
    else:
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * rx, v.co.y * ry, v.co.z * rz)) + C0

    # open the bottom (neck)
    bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                           plane_co=Vector((0, 0, neck_z)), plane_no=Vector((0, 0, 1)), clear_inner=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # open a FACE WINDOW only — a narrow front hole over the face disc, so the
    # shell keeps covering the sides (|y|>yw) where the base ears live (they'd
    # otherwise poke through a full-front opening).
    dead = [f for f in bm.faces
            if f.calc_center_median().x > front_x
            and abs(f.calc_center_median().y) < yw
            and zlo < f.calc_center_median().z < zhi]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # relax the window rim
    for _ in range(8):
        for v in [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]:
            nb = [e.other_vert(v) for e in v.link_edges if len(e.link_faces) == 1]
            if len(nb) == 2:
                v.co = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3

    if ears:
        _ovoid_ears(bm, ears, C0, rx, ry, rz)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data); bm.free()
    C.solidify(ob, 0.0026, offset=1.0)
    C.set_material(ob, name + "Mat", color, 0.6)
    C.smart_uv(ob); C.rigid_parent(ob, rig, "Head")
    C.export([ob], rig, out, wip=C.wip(name.lower()))
