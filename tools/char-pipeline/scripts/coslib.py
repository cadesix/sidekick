"""Shared helpers for cosmetic item builds (skinned garments + rigid props).
Import from build_* scripts:  sys.path.insert(0, "scripts"); import coslib as C
All the patterns here are the proven ones from build_shirt/pants/shoes/hat/phone.
"""
import bpy, bmesh, math, os
from mathutils import Vector

PIPE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # tools/char-pipeline
REPO = os.path.dirname(os.path.dirname(PIPE))                        # monorepo root
MASTER = os.path.join(PIPE, "blender", "character_master.blend")
COSDIR = os.path.join(REPO, "packages", "web", "public", "cosmetics")
CHAR_GLB = os.path.join(REPO, "packages", "web", "public", "sidekick-rigged.glb")  # == yellow_final_v9
WIPDIR = os.path.join(PIPE, ".wip")


def wip(name):
    os.makedirs(WIPDIR, exist_ok=True)
    return os.path.join(WIPDIR, f"{name}_wip.blend")


def load_master():
    bpy.ops.wm.open_mainfile(filepath=MASTER)
    body = max([o for o in bpy.context.scene.objects if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
    return body, rig


def dup_region(body, name, exclude_sub=(), keep=None):
    """Duplicate the body and keep only polys whose dominant vertex-group either
    is in `keep` (exact names) or — if keep is None — does NOT contain any
    substring in `exclude_sub`. FaceSprite polys always dropped."""
    gi = {g.index: g.name for g in body.vertex_groups}
    fs_idx = list(body.data.materials).index(bpy.data.materials["FaceSprite"])
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    me = ob.data

    def dom(poly):
        acc = {}
        for vi in poly.vertices:
            for g in me.vertices[vi].groups:
                acc[gi[g.group]] = acc.get(gi[g.group], 0) + g.weight
        return max(acc, key=acc.get) if acc else ""

    if keep is not None:
        doom = {p.index for p in me.polygons
                if p.material_index == fs_idx or dom(p) not in keep}
    else:
        doom = {p.index for p in me.polygons
                if p.material_index == fs_idx
                or any(s in dom(p) for s in exclude_sub) or not dom(p)}
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in doom], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me); bm.free(); me.update()
    return ob


def dup_geo(body, name, filt):
    """Duplicate the body and keep only polys whose WORLD centroid passes filt.
    Use for regions where vertex-group dominance frontiers are patchy (e.g.
    footwear rims near the knee) — a position filter guarantees the follow-up
    bisect plane forms the boundary, not the jagged dominance frontier."""
    fs_idx = list(body.data.materials).index(bpy.data.materials["FaceSprite"])
    mw = body.matrix_world
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    me = ob.data
    doom = set()
    for p in me.polygons:
        if p.material_index == fs_idx:
            doom.add(p.index); continue
        c = mw @ (sum((me.vertices[vi].co for vi in p.vertices), Vector()) / len(p.vertices))
        if not filt(c):
            doom.add(p.index)
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in doom], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me); bm.free(); me.update()
    return ob


def cut(ob, co, no, **kw):
    """World-space bisect on the object's mesh."""
    mw = ob.matrix_world; mwi = mw.inverted()
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.bisect_plane(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
                           plane_co=mwi @ Vector(co), plane_no=mwi.to_3x3() @ Vector(no), **kw)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me); bm.free(); me.update()


def offset_loosen(ob, offset, loops=2, edit=None):
    """Push verts out along normals, then relax interior verts. Optional `edit`
    callback (bm) runs after loosen for item-specific vertex tweaks."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bm.normal_update()
    for v in bm.verts:
        v.co = v.co + v.normal * offset
    bnd = lambda v: any(len(e.link_faces) == 1 for e in v.link_edges)
    inner = [v for v in bm.verts if not bnd(v)]
    for _ in range(loops):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)
    if edit:
        edit(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()


def region_smooth(ob, filt, iters=15, factor=0.5, axes=(True, True, True), reinflate=0.0,
                  reinflate_scale=None):
    """Laplacian-smooth only the verts whose WORLD position passes filt — used to
    erase body detail a duplicated surface inherits (e.g. toe bumps on footwear).
    axes limits the smoothing directions ((x,y,False) rounds a plan outline while
    keeping z, preserving a flattened sole). reinflate pushes the region back out
    along normals afterwards to recover the clearance smoothing shrinks away;
    reinflate_scale(world_co)->0..1 feathers it so the band edge leaves no ledge."""
    mw = ob.matrix_world
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    vs = [v for v in bm.verts if filt(mw @ v.co)]
    print(f"region_smooth[{ob.name}]: {len(vs)}/{len(bm.verts)} verts, "
          f"iters={iters} factor={factor} axes={axes} reinflate={reinflate}")
    for _ in range(iters):
        bmesh.ops.smooth_vert(bm, verts=vs, factor=factor,
                              use_axis_x=axes[0], use_axis_y=axes[1], use_axis_z=axes[2])
    if reinflate:
        bm.normal_update()
        for v in vs:
            n = Vector((v.normal.x if axes[0] else 0.0,
                        v.normal.y if axes[1] else 0.0,
                        v.normal.z if axes[2] else 0.0))
            if n.length > 1e-6:
                s = reinflate_scale(mw @ v.co) if reinflate_scale else 1.0
                v.co += n.normalized() * (reinflate * max(0.0, min(1.0, s)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()


def decimate(ob, target_tris):
    me = ob.data
    dec = ob.modifiers.new("dec", "DECIMATE")
    me.calc_loop_triangles()
    dec.ratio = min(1.0, target_tris / max(1, len(me.loop_triangles)))
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="dec")


def boundary_finish(ob, planes, relax=14):
    """Snap boundary verts to their cut planes then relax the loops. Planes:
    list of (axis, value) with axis in 'z'|'absy'. MUST be the last geo step."""
    mw = ob.matrix_world; mwi = mw.inverted()
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    for v in bm.verts:
        if not any(len(e.link_faces) == 1 for e in v.link_edges):
            continue
        p = mw @ v.co
        for ax, val in planes:
            if ax == "z" and abs(p.z - val) < 0.008:
                p.z = val; v.co = mwi @ p
            elif ax == "absy" and abs(abs(p.y) - val) < 0.008:
                p.y = math.copysign(val, p.y); v.co = mwi @ p
    for _ in range(relax):
        bv = [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]
        np_ = {}
        for v in bv:
            nb = [e.other_vert(v) for e in v.link_edges if len(e.link_faces) == 1]
            if len(nb) == 2:
                np_[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, co in np_.items():
            v.co = co
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()


def solidify(ob, thick, offset=-1.0):
    sol = ob.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = thick; sol.offset = offset; sol.use_rim = True
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="sol")


def set_material(ob, name, color, rough, metallic=0.0):
    me = ob.data
    me.materials.clear()
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return mat


def smart_uv(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def finish_weights(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def strip_skin(ob):
    ob.vertex_groups.clear()
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)


def rigid_parent(ob, rig, bone_name):
    """Origin at the bone head, parent_set BONE keep_transform (hat pattern)."""
    world = rig.matrix_world @ rig.data.bones[bone_name].head_local
    bpy.context.scene.cursor.location = world
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    rig.data.bones.active = rig.data.bones[bone_name]
    bpy.ops.object.parent_set(type="BONE", keep_transform=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def export(objs, rig, out, skinned=False, wip=None):
    if wip:
        bpy.ops.wm.save_as_mainfile(filepath=wip)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    kw = dict(filepath=out, export_format="GLB", use_selection=True, export_yup=True)
    if skinned:
        kw.update(export_skins=True, export_apply=False)
    bpy.ops.export_scene.gltf(**kw)
    for o in objs:
        o.data.calc_loop_triangles()
        print(f"{o.name}: {len(o.data.vertices)} verts, {len(o.data.loop_triangles)} tris")
    print("exported", out)


# ---------- primitive builders (world-space, appended into an open bmesh) ----------

def bm_new_obj(name):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def add_lathe(bm, rings, nseg=28, sy=1.0, cx=0.005, close_top=False, close_bottom=False):
    """Surface of revolution. rings = [(radius, z, cx_override_or_None), ...].
    Elliptical y-squash sy. Returns list of new verts."""
    rows = []
    for (r, z, cxo) in rings:
        c = cx if cxo is None else cxo
        row = [bm.verts.new((c + r * math.cos(2 * math.pi * i / nseg),
                             sy * r * math.sin(2 * math.pi * i / nseg), z))
               for i in range(nseg)]
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for i in range(nseg):
            bm.faces.new((a[i], a[(i + 1) % nseg], b[(i + 1) % nseg], b[i]))
    if close_top:
        r, z, cxo = rings[-1]
        c = cx if cxo is None else cxo
        vtop = bm.verts.new((c, 0, z))
        for i in range(nseg):
            bm.faces.new((rows[-1][i], rows[-1][(i + 1) % nseg], vtop))
    if close_bottom:
        r, z, cxo = rings[0]
        c = cx if cxo is None else cxo
        vbot = bm.verts.new((c, 0, z))
        for i in range(nseg):
            bm.faces.new((rows[0][(i + 1) % nseg], rows[0][i], vbot))
    return [v for row in rows for v in row]


def add_tube(bm, path, radius, nseg=8, taper_ends=True, cap=True):
    """Tube along a list of Vector path points. radius may be a callable(t)."""
    import mathutils
    rows = []
    n = len(path)
    for i, p in enumerate(path):
        t = i / (n - 1)
        r = radius(t) if callable(radius) else radius
        if taper_ends:
            r *= min(1.0, 4.0 * min(t, 1 - t) + 0.35)
        d = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        u = d.cross(Vector((0, 0, 1)))
        u = u.normalized() if u.length > 1e-6 else Vector((1, 0, 0))
        w = d.cross(u).normalized()
        row = [bm.verts.new(p + u * (r * math.cos(2 * math.pi * k / nseg))
                            + w * (r * math.sin(2 * math.pi * k / nseg)))
               for k in range(nseg)]
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for k in range(nseg):
            bm.faces.new((a[k], a[(k + 1) % nseg], b[(k + 1) % nseg], b[k]))
    if cap:
        for row, flip in ((rows[0], True), (rows[-1], False)):
            c = sum((v.co for v in row), Vector()) / nseg
            vc = bm.verts.new(c)
            for k in range(nseg):
                tri = (row[k], row[(k + 1) % nseg], vc)
                bm.faces.new(tri if flip else tuple(reversed(tri)))
    return [v for row in rows for v in row]


def rounded_rect(w, h, r, seg=3):
    cx, cy = w / 2 - r, h / 2 - r
    pts = []
    for px, py, a0 in [(cx, cy, 0.0), (-cx, cy, 90.0), (-cx, -cy, 180.0), (cx, -cy, 270.0)]:
        for k in range(seg + 1):
            a = math.radians(a0 + 90.0 * k / seg)
            pts.append((px + r * math.cos(a), py + r * math.sin(a)))
    return pts


def add_slab(bm, origin, ax, ay, az, w, h, r, depth, scales=(1.0, 1.0)):
    """Rounded-rect slab: profile in (ax,ay) plane extruded along az from 0..depth.
    scales = (scale at z0, scale at z1) for tapered boxes. Returns verts."""
    outline = rounded_rect(w, h, r)
    lo = [bm.verts.new(origin + ax * (x * scales[0]) + ay * (y * scales[0])) for x, y in outline]
    hi = [bm.verts.new(origin + ax * (x * scales[1]) + ay * (y * scales[1]) + az * depth) for x, y in outline]
    n = len(outline)
    for i in range(n):
        bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    return lo + hi


def assign_group(ob, verts_idx, weights):
    """weights: dict bone_name -> w, applied to the given vertex indices."""
    for bn, w in weights.items():
        vg = ob.vertex_groups.get(bn) or ob.vertex_groups.new(name=bn)
        vg.add(verts_idx, w, "REPLACE")
