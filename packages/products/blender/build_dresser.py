"""Build the 3-drawer dresser (assembled, anchored to the wall) and export the GLB + layout.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python build_dresser.py [-- --preview] [-- --no-export]

Inputs
- packages/products/data/dresser.json   part origins and coarse boxes (written by scripts/gen-dresser.mjs)

Outputs
- apps/web/public/models/dresser.glb             one top-level node per part ID, mesh in part-local mm
- packages/products/blender/dresser.layout.json   part positions, coarse boxes, feature positions
- packages/products/blender/previews/dresser_*.png (with --preview) EEVEE renders

The product JSON is the single source of coordinates: every mesh is modelled inside its part's boxes, so
the coarse boxes (and the geometry tests on them) stay exact. Axes are the engine's: +Y up, +X right
(seen from the front), +Z front, 1 unit = 1 mm. All parts keep rotation [0, 0, 0].
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib  # noqa: E402

import lib  # noqa: E402

importlib.reload(lib)
from lib import Part, mat, xf  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GLB_OUT = os.path.join(ROOT, "apps", "web", "public", "models", "dresser.glb")
LAYOUT_OUT = os.path.join(HERE, "dresser.layout.json")
PREVIEW_DIR = os.path.join(HERE, "previews")
PRODUCT_JSON = os.path.join(ROOT, "packages", "products", "data", "dresser.json")

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

PROD = json.load(open(PRODUCT_JSON))
PARTS = {p["id"]: p for p in PROD["parts"]}
PART_IDS = [p["id"] for p in PROD["parts"]]

# --------------------------------------------------------------------------------------------
# palette: light birch-white furniture so the engine's red/green highlights stay readable

M = dict(
    panel=mat("dr_panel", "#ece6da", 0.0, 0.62),
    panel_in=mat("dr_panel_inner", "#ddd5c6", 0.0, 0.7),
    edge=mat("dr_edge_band", "#c9a57a", 0.0, 0.5),
    raw=mat("dr_raw_edge", "#b9a27f", 0.0, 0.85),
    hole=mat("dr_hole", "#3a3530", 0.0, 0.9),
    back=mat("dr_hardboard", "#b49d7f", 0.0, 0.8),
    front=mat("dr_front", "#f4f2ed", 0.0, 0.45),
    box=mat("dr_box", "#e3dccd", 0.0, 0.7),
    handle=mat("dr_handle", "#7e848c", 0.85, 0.32),
    runner=mat("dr_runner", "#a7acb2", 0.6, 0.4),
    roller=mat("dr_roller", "#3d74c9", 0.0, 0.4),
    cam=mat("dr_cam", "#c3c7cc", 0.9, 0.3),
    slot=mat("dr_slot", "#2b2d31", 0.4, 0.5),
    wall=mat("dr_wall", "#eef0f2", 0.0, 0.92),
    bracket=mat("dr_bracket", "#6c7179", 0.8, 0.35),
    screw=mat("dr_screw", "#9aa0a8", 1.0, 0.35),
    strap=mat("dr_strap", "#e2572b", 0.0, 0.7),
)


def boxes(pid):
    """Coarse boxes of a part (local): list of (min, max, color)."""
    out = []
    for b in PARTS[pid]["geometry"]["boxes"]:
        c, s = b["position"], b["size"]
        out.append(([c[i] - s[i] / 2 for i in range(3)], [c[i] + s[i] / 2 for i in range(3)], b["color"]))
    return out


def ctr(lo, hi):
    return [(lo[i] + hi[i]) / 2 for i in range(3)]


def size(lo, hi):
    return [hi[i] - lo[i] for i in range(3)]


def slab(p, lo, hi, m, bevel=1.2):
    p.box(size(lo, hi), ctr(lo, hi), m, bevel=bevel, seg=2)


def keep_boxes(p, pid):
    """The layout keeps the product's coarse boxes as they are (meshes are modelled inside them)."""
    for lo, hi, color in boxes(pid):
        p.boxes.append({"size": [round(v, 3) for v in size(lo, hi)], "position": [round(v, 3) for v in ctr(lo, hi)], "color": color})


# --------------------------------------------------------------------------------------------
# parts


def build_side(pid):
    p = Part(pid)
    (lo, hi, _), (elo, ehi, _), *strips = boxes(pid)
    slab(p, lo, hi, M["panel"], 1.0)
    p.box(size(elo, ehi), ctr(elo, ehi), M["edge"], bevel=0.8)
    inner_x = strips[0][0][0] if strips[0][0][0] > lo[0] else strips[0][1][0]  # face the strips sit on
    sign = 1 if inner_x > ctr(lo, hi)[0] else -1  # +1: inner face is +x
    face = hi[0] if sign > 0 else lo[0]
    # rows of runner holes (shallow dark discs) along each strip, plus cam bolt holes near top and bottom
    for slo, shi, _ in strips:
        y = (slo[1] + shi[1]) / 2
        z = slo[2] + 4
        while z <= shi[2] - 4:
            p.cyl(2.6, 0.4, (face + sign * 0.2, y, z), M["hole"], axis="x", seg=12)
            z += 16
    for y in (69.0, 891.0):
        for z in (-150.0, 150.0):
            p.cyl(3.5, 0.4, (face + sign * 0.2, y - PARTS[pid]["position"][1], z), M["hole"], axis="x", seg=14)
    keep_boxes(p, pid)
    return p


def build_bottom():
    p = Part("bottom_panel")
    (lo, hi, _), (plo, phi, _) = boxes("bottom_panel")
    slab(p, lo, hi, M["panel"])
    slab(p, plo, phi, M["panel_in"], 1.0)
    p.box([size(lo, hi)[0], size(lo, hi)[1], 1.5], [0, ctr(lo, hi)[1], hi[2] - 0.75], M["edge"], bevel=0.5)
    keep_boxes(p, "bottom_panel")
    return p


def build_top():
    p = Part("top_panel")
    (lo, hi, _), (elo, ehi, _) = boxes("top_panel")
    slab(p, lo, hi, M["panel"], 1.0)
    p.box(size(elo, ehi), ctr(elo, ehi), M["edge"], bevel=0.8)
    keep_boxes(p, "top_panel")
    return p


def build_cross_rails():
    p = Part("cross_rails")
    for lo, hi, _ in boxes("cross_rails"):
        slab(p, lo, hi, M["panel"], 1.0)
        p.box([size(lo, hi)[0], size(lo, hi)[1], 1.5], [0, ctr(lo, hi)[1], hi[2] - 0.75], M["edge"], bevel=0.5)
    keep_boxes(p, "cross_rails")
    return p


def build_cams():
    p = Part("cam_locks")
    for lo, hi, _ in boxes("cam_locks"):
        c = ctr(lo, hi)
        r = size(lo, hi)[0] / 2
        h = size(lo, hi)[1]
        p.cyl(r, h * 0.6, (c[0], c[1], c[2]), M["cam"], axis="y", seg=28)
        down = c[1] > 0  # caps under the top panel face down
        y_face = lo[1] + 0.3 if down else hi[1] - 0.3
        # arrow: a slot plus a tip pointing at the side panel bolt (outward in x)
        sx = 1 if c[0] > 0 else -1
        p.box([r * 1.2, 0.6, 1.6], (c[0], y_face, c[2]), M["slot"])
        p.box([2.4, 0.6, 3.6], (c[0] + sx * r * 0.6, y_face, c[2]), M["slot"])
    keep_boxes(p, "cam_locks")
    return p


def build_back():
    p = Part("back_panel")
    (lo, hi, _), = boxes("back_panel")
    p.box(size(lo, hi), ctr(lo, hi), M["back"], bevel=0.4)
    keep_boxes(p, "back_panel")
    return p


def build_runners(pid):
    p = Part(pid)
    bs = boxes(pid)
    n = len(bs) // 2
    for (lo, hi, _), (rlo, rhi, _) in zip(bs[:n], bs[n:]):
        # L profile: a plate on the side panel plus a bottom lip the drawer wheel runs on
        left = PARTS[pid]["position"][0] < 0  # left runners: inner (drawer) side is +x
        inner, outer = (hi[0], lo[0]) if left else (lo[0], hi[0])
        sx = 1 if left else -1
        plate = 2.0
        p.box([plate, size(lo, hi)[1], size(lo, hi)[2]], (outer + sx * plate / 2, ctr(lo, hi)[1], ctr(lo, hi)[2]), M["runner"], bevel=0.4)
        p.box([size(lo, hi)[0], 2.0, size(lo, hi)[2]], (ctr(lo, hi)[0], lo[1] + 1.0, ctr(lo, hi)[2]), M["runner"], bevel=0.4)
        p.box([size(lo, hi)[0] - 6, 2.0, size(lo, hi)[2]], (ctr(lo, hi)[0] - sx * 3, hi[1] - 1.0, ctr(lo, hi)[2]), M["runner"], bevel=0.4)
        # screws through the plate
        for z in (lo[2] + 30, ctr(lo, hi)[2], hi[2] - 30):
            p.cyl(3.0, 1.2, (outer + sx * (plate + 0.6), ctr(lo, hi)[1], z), M["screw"], axis="x", seg=12)
        # front roller (wheel) with an axle cap
        rc = ctr(rlo, rhi)
        rr = min(size(rlo, rhi)[1], size(rlo, rhi)[2]) / 2
        p.cyl(rr, size(rlo, rhi)[0] - 1.0, rc, M["roller"], axis="x", seg=24)
        p.cyl(rr * 0.35, size(rlo, rhi)[0], rc, M["screw"], axis="x", seg=12)
    keep_boxes(p, pid)
    return p


def build_drawer(pid):
    p = Part(pid)
    (flo, fhi, _), (blo, bhi, _), (hlo, hhi, _) = boxes(pid)
    slab(p, flo, fhi, M["front"], 2.0)
    # hollow box: two sides, back, bottom (12 mm walls)
    t = 12.0
    p.box([t, size(blo, bhi)[1], size(blo, bhi)[2]], (blo[0] + t / 2, ctr(blo, bhi)[1], ctr(blo, bhi)[2]), M["box"], bevel=0.6)
    p.box([t, size(blo, bhi)[1], size(blo, bhi)[2]], (bhi[0] - t / 2, ctr(blo, bhi)[1], ctr(blo, bhi)[2]), M["box"], bevel=0.6)
    p.box([size(blo, bhi)[0] - 2 * t, size(blo, bhi)[1], t], (0, ctr(blo, bhi)[1], blo[2] + t / 2), M["box"], bevel=0.6)
    p.box([size(blo, bhi)[0] - 2 * t, 4.0, size(blo, bhi)[2] - t], (0, blo[1] + 2.0, ctr(blo, bhi)[2] + t / 2), M["panel_in"], bevel=0.3)
    # bar handle on two posts
    hc = ctr(hlo, hhi)
    L = size(hlo, hhi)[0]
    r = size(hlo, hhi)[1] / 2
    p.cyl(r, L - 2, (hc[0], hc[1], hhi[2] - r), M["handle"], axis="x", seg=20)
    for sx in (-1, 1):
        p.cyl(r * 0.75, size(hlo, hhi)[2] - r, (hc[0] + sx * (L / 2 - 16), hc[1], hlo[2] + (size(hlo, hhi)[2] - r) / 2), M["handle"], axis="z", seg=16)
    keep_boxes(p, pid)
    return p


def build_wall():
    p = Part("wall")
    (lo, hi, _), = boxes("wall")
    p.box(size(lo, hi), ctr(lo, hi), M["wall"], bevel=0.0)
    keep_boxes(p, "wall")
    return p


def build_bracket():
    p = Part("wall_bracket")
    (lo, hi, _), = boxes("wall_bracket")
    c = ctr(lo, hi)
    p.box([size(lo, hi)[0], size(lo, hi)[1], 2.0], (c[0], c[1], lo[2] + 1.0), M["bracket"], bevel=0.5)
    p.box([size(lo, hi)[0] - 10, 4.0, size(lo, hi)[2]], (c[0], hi[1] - 2.0, c[2]), M["bracket"], bevel=0.5)  # hook lip
    for sx in (-1, 1):
        p.cyl(3.2, 1.6, (c[0] + sx * 16, c[1] - 6, lo[2] + 2.8), M["screw"], axis="z", seg=14)
    keep_boxes(p, "wall_bracket")
    return p


def build_strap():
    p = Part("tip_strap")
    (plo, phi, _), (slo, shi, _) = boxes("tip_strap")
    pc = ctr(plo, phi)
    p.box(size(plo, phi), pc, M["bracket"], bevel=0.6)
    for sx in (-1, 1):
        p.cyl(3.0, 1.0, (pc[0] + sx * 12, phi[1] - 0.5, pc[2] + 6), M["screw"], axis="y", seg=12)
    p.box(size(slo, shi), ctr(slo, shi), M["strap"], bevel=0.3)
    # buckle near the dresser end
    p.box([size(slo, shi)[0] + 2, size(slo, shi)[1], 10], (0, ctr(slo, shi)[1], shi[2] - 20), M["screw"], bevel=0.3)
    keep_boxes(p, "tip_strap")
    return p


BUILDERS = {
    "left_side": lambda: build_side("left_side"),
    "right_side": lambda: build_side("right_side"),
    "bottom_panel": build_bottom,
    "top_panel": build_top,
    "cross_rails": build_cross_rails,
    "cam_locks": build_cams,
    "back_panel": build_back,
    "rail_left": lambda: build_runners("rail_left"),
    "rail_right": lambda: build_runners("rail_right"),
    "drawer_1": lambda: build_drawer("drawer_1"),
    "drawer_2": lambda: build_drawer("drawer_2"),
    "drawer_3": lambda: build_drawer("drawer_3"),
    "wall": build_wall,
    "wall_bracket": build_bracket,
    "tip_strap": build_strap,
}

# --------------------------------------------------------------------------------------------
# scene


def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for d in list(coll):
            coll.remove(d)
    lib._MATS.clear()
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def main():
    missing = sorted(set(PART_IDS) - set(BUILDERS))
    if missing:
        raise SystemExit(f"no builder for {missing}")
    reset_scene()
    coll = bpy.data.collections.new("dresser")
    bpy.context.scene.collection.children.link(coll)
    objs, parts = {}, {}
    for pid in PART_IDS:
        part = BUILDERS[pid]()
        parts[pid] = part
        objs[pid] = part.finish(coll, PARTS[pid]["position"])

    layout = {"units": "mm", "source": "packages/products/blender/build_dresser.py", "parts": {}, "features": {}}
    worst = []
    for pid in PART_IDS:
        ob, part = objs[pid], parts[pid]
        vs = [v.co for v in ob.data.vertices]
        lo = [min(v[i] for v in vs) for i in range(3)]
        hi = [max(v[i] for v in vs) for i in range(3)]
        # mesh must stay inside the union of its coarse boxes (bounding box of them, +1 mm)
        blo = [min(b["position"][i] - b["size"][i] / 2 for b in part.boxes) for i in range(3)]
        bhi = [max(b["position"][i] + b["size"][i] / 2 for b in part.boxes) for i in range(3)]
        out = max(max(blo[i] - lo[i], hi[i] - bhi[i]) for i in range(3))
        if out > 1.0:
            worst.append(f"{pid} mesh exceeds boxes by {out:.2f} mm")
        layout["parts"][pid] = {
            "position": PARTS[pid]["position"],
            "rotation": [0, 0, 0],
            "bounds": {"size": [round(hi[i] - lo[i], 2) for i in range(3)], "center": [round((hi[i] + lo[i]) / 2, 2) for i in range(3)]},
            "boxes": part.boxes,
            "triangles": sum(len(pl.vertices) - 2 for pl in ob.data.polygons),
        }
    for f in PROD["features"]:
        layout["features"][f["id"]] = {"partId": f["partId"], "position": f["position"]}
    with open(LAYOUT_OUT, "w") as fh:
        json.dump(layout, fh, indent=1, ensure_ascii=False)
    print("[layout] wrote", LAYOUT_OUT)
    print("[check] mesh inside boxes:", worst or "ok")
    print("[check] triangles:", sum(p["triangles"] for p in layout["parts"].values()))
    if "--no-export" not in ARGS:
        export_glb(objs)
    if "--preview" in ARGS:
        render_previews(objs)


def export_glb(objs):
    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob.name in PART_IDS)
    bpy.context.view_layer.objects.active = objs[PART_IDS[0]]
    bpy.ops.export_scene.gltf(
        filepath=GLB_OUT,
        export_format="GLB",
        use_selection=True,
        export_yup=False,
        export_apply=True,
        export_texcoords=False,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
    )
    print(f"[glb] wrote {GLB_OUT} ({os.path.getsize(GLB_OUT) / 1e6:.2f} MB)")
    verify_glb(GLB_OUT)


def verify_glb(path):
    import struct

    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 12)[0]
    gj = json.loads(data[20 : 20 + n])
    names = {nd.get("name") for nd in gj.get("nodes", [])}
    missing = [pid for pid in PART_IDS if pid not in names]
    for nd in gj["nodes"]:
        if nd.get("name") in PART_IDS:
            t = [round(v, 1) for v in nd.get("translation", [0, 0, 0])]
            want = [round(v, 1) for v in PARTS[nd["name"]]["position"]]
            flag = "" if t == want else f"  != {want}"
            print(f"   {nd['name']:<14} t={t}{flag}")
    print(f"[glb] all {len(PART_IDS)} part nodes present" if not missing else f"[glb] MISSING nodes: {missing}")


def look_at(cam, pos, target):
    d = (Vector(target) - Vector(pos)).normalized()
    z = -d
    x = Vector((0, 1, 0)).cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    cam.matrix_world = m


def render_previews(objs):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    sc.render.resolution_x, sc.render.resolution_y = 1400, 1000
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    world = bpy.data.worlds.get("preview") or bpy.data.worlds.new("preview")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.8, 0.82, 0.85, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = world
    try:
        sc.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    # floor
    fl = Part("preview_floor")
    fl.box([2400, 2, 1600], (0, -1, 300), mat("dr_floor", "#cfc8bd", 0.0, 0.8))
    floor = fl.finish(sc.collection)
    for name, loc, energy, size_ in (("key", (1200, 1600, 1500), 1.6e7, 900), ("fill", (-1300, 900, 1200), 6e6, 1100),
                                      ("rim", (300, 1500, -400), 3e6, 700)):  # fmt: skip
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size_
        lo = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lo)
        look_at(lo, loc, (0, 450, 0))
    cd = bpy.data.cameras.new("cam")
    cd.lens = 45
    cd.clip_start = 10
    cd.clip_end = 20000
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    shots = {
        "full_34": ((1500, 1250, 2100), (0, 430, -40), []),
        "drawers_open": ((1300, 1000, 2000), (0, 420, 120), ["open"]),
        "rails_close": ((-200, 520, 900), (300, 380, 80), ["no_drawers"]),
        "anchor_close": ((650, 1350, 300), (0, 895, -220), []),
    }
    base = {k: objs[k].location.copy() for k in PART_IDS}
    for name, (pos, tgt, flags) in shots.items():
        for k in PART_IDS:
            objs[k].location = base[k]
            objs[k].hide_render = False
        if "open" in flags:
            for k, dz in (("drawer_1", 300), ("drawer_2", 160)):
                objs[k].location = base[k] + Vector((0, 0, dz))
        if "no_drawers" in flags:
            for k in ("drawer_1", "drawer_2", "drawer_3"):
                objs[k].hide_render = True
        look_at(cam, pos, tgt)
        sc.render.filepath = os.path.join(PREVIEW_DIR, f"dresser_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[preview] {sc.render.filepath}")
    for k in PART_IDS:
        objs[k].location = base[k]
        objs[k].hide_render = False
    bpy.data.objects.remove(floor, do_unlink=True)


main()
