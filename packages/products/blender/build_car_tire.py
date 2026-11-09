"""Build the spare-tire scene (generic hatchback, front-left wheel) and export the GLB + layout.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python build_car_tire.py [-- --preview] [-- --no-export]

Inputs
- packages/products/data/car_tire.json   part positions, coarse boxes and features (from scripts/gen-car_tire.mjs)
Outputs
- apps/web/public/models/car_tire.glb           one top-level node per part ID, mesh in part-local mm
- packages/products/blender/car_tire.layout.json   positions, coarse boxes, feature positions, mesh bounds
- packages/products/blender/previews/car_tire_*.png  (with --preview) EEVEE renders

Axes are the engine's: +Y up, +X car front, +Z toward the near (left) side, 1 unit = 1 mm.
All parts keep rotation [0, 0, 0]; meshes are modelled in their installed pose.
lib.py is imported, never edited; helpers that only this product needs live here.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib  # noqa: E402
from lib import Part, mat, xf  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GLB_OUT = os.path.join(ROOT, "apps", "web", "public", "models", "car_tire.glb")
LAYOUT_OUT = os.path.join(HERE, "car_tire.layout.json")
PREVIEW_DIR = os.path.join(HERE, "previews")
PRODUCT_JSON = os.path.join(ROOT, "packages", "products", "data", "car_tire.json")
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

PROD = json.load(open(PRODUCT_JSON))
POS = {p["id"]: tuple(p["position"]) for p in PROD["parts"]}
PART_IDS = [p["id"] for p in PROD["parts"]]
WC = 317.0


def L(pid, w):
    """World point -> part-local."""
    o = POS[pid]
    return (w[0] - o[0], w[1] - o[1], w[2] - o[2])


# --------------------------------------------------------------------------------------------
# materials
M = {}


def mats():
    M["paint"] = mat("car_paint", "#5f7f9e", metallic=0.55, roughness=0.32)
    M["paint_dark"] = mat("car_trim", "#22262c", roughness=0.6)
    M["glass"] = mat("car_glass", "#1d2833", metallic=0.2, roughness=0.08)
    M["chrome"] = mat("chrome", "#d9dde2", metallic=1.0, roughness=0.18)
    M["light"] = mat("headlight", "#eef2f6", roughness=0.15, emission="#ffffff", emission_strength=0.3)
    M["amber"] = mat("indicator", "#ff9d1c", roughness=0.3, emission="#ff8a00", emission_strength=1.5)
    M["tail"] = mat("taillight", "#b3121a", roughness=0.25, emission="#c0101a", emission_strength=0.6)
    M["rubber"] = mat("tire_rubber", "#17181b", roughness=0.85)
    M["rubber_hi"] = mat("tire_side", "#26282c", roughness=0.75)
    M["steel"] = mat("wheel_steel", "#9aa1a9", metallic=0.8, roughness=0.35)
    M["steel_dark"] = mat("spare_steel", "#3d4249", metallic=0.6, roughness=0.45)
    M["disc"] = mat("brake_disc", "#7c8087", metallic=0.9, roughness=0.4)
    M["hub"] = mat("hub_metal", "#5d636b", metallic=0.7, roughness=0.5)
    M["caliper"] = mat("caliper", "#a4262c", roughness=0.4)
    M["nut"] = mat("nut_zinc", "#c9cdd2", metallic=1.0, roughness=0.25)
    M["cover"] = mat("wheel_cover", "#b8bec6", metallic=0.4, roughness=0.35)
    M["asphalt"] = mat("asphalt", "#3b3e44", roughness=0.95)
    M["line"] = mat("road_line", "#e8e2c8", roughness=0.7)
    M["jack"] = mat("jack_paint", "#2f3a4a", metallic=0.3, roughness=0.5)
    M["jack_hi"] = mat("jack_screw", "#b5bac0", metallic=0.9, roughness=0.3)
    M["wrench"] = mat("wrench", "#6b7280", metallic=0.9, roughness=0.35)
    M["chock"] = mat("chock_rubber", "#e0a21a", roughness=0.7)
    M["tri_red"] = mat("triangle_red", "#e02424", roughness=0.3, emission="#ff2a2a", emission_strength=0.4)
    M["tri_frame"] = mat("triangle_frame", "#2b2f36", roughness=0.6)
    M["notch"] = mat("jack_notch", "#f2c230", roughness=0.4, emission="#f2b705", emission_strength=0.6)
    M["yellow"] = mat("spare_stripe", "#f2c230", roughness=0.5)


# --------------------------------------------------------------------------------------------
# local helpers (not in lib.py)


def lathe(p: Part, profile, m, seg=72, pos=(0, 0, 0), deform=None):
    """Revolve a (radius, z) polyline around the local Z axis (closed loop). deform(Vector) -> Vector."""
    bm = bmesh.new()
    n = len(profile)
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for r, z in profile:
            v = Vector((r * math.cos(a), r * math.sin(a), z))
            if deform:
                v = deform(v)
            ring.append(bm.verts.new(v + Vector(pos)))
        rings.append(ring)
    for i in range(seg):
        a, b = rings[i], rings[(i + 1) % seg]
        for j in range(n):
            k = (j + 1) % n
            f = bm.faces.new((a[j], b[j], b[k], a[k]))
            f.smooth = True
    p.add(bm, m)


def extrude_poly(p: Part, pts, z0, z1, m, smooth=False):
    """Prism from a closed (x, y) polygon between z0 and z1."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in pts]
    hi = [bm.verts.new((x, y, z1)) for x, y in pts]
    from mathutils.geometry import tessellate_polygon

    for a, b, c in tessellate_polygon([[Vector((x, y, 0)) for x, y in pts]]):
        for ring, flip in ((lo, True), (hi, False)):
            tri = [ring[a], ring[b], ring[c]]
            try:
                bm.faces.new(list(reversed(tri)) if flip else tri)
            except ValueError:
                pass
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        f.smooth = smooth
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    p.add(bm, m)


def arc(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def tire_profile(width, r_out=317.0, r_bead=192.0):
    h = width / 2
    return [
        (r_bead, -h + 8), (r_bead + 30, -h - 2), (r_bead + 75, -h - 4), (r_out - 28, -h + 2), (r_out - 6, -h + 14),
        (r_out, -h + 30), (r_out, -h * 0.35), (r_out - 7, -h * 0.3), (r_out - 7, -h * 0.2), (r_out, -h * 0.15),
        (r_out, h * 0.15), (r_out - 7, h * 0.2), (r_out - 7, h * 0.3), (r_out, h * 0.35), (r_out, h - 30),
        (r_out - 6, h - 14), (r_out - 28, h - 2), (r_bead + 75, h + 4), (r_bead + 30, h + 2), (r_bead, h - 8),
    ]  # fmt: skip


def flat_deform(v: Vector) -> Vector:
    """Squash the bottom of a 317 mm tire: wider sidewalls and a flat contact patch on the ground."""
    ang = math.atan2(v.y, v.x)
    w = max(0.0, math.cos(ang + math.pi / 2)) ** 3  # 1 at the bottom, 0 at the sides
    r = math.hypot(v.x, v.y)
    r2 = r * (1 + 0.075 * w)
    x, y = v.x * r2 / max(r, 1e-6), v.y * r2 / max(r, 1e-6)
    y = max(y, -WC)  # flat on the ground
    z = v.z * (1 + 0.22 * w * max(0.0, (r - 200) / 117))
    return Vector((x, y, z))


def tire(p: Part, center, width, flat=False):
    lathe(p, tire_profile(width), M["rubber"], seg=96, pos=center, deform=flat_deform if flat else None)


def steel_wheel(p: Part, center, width, m_rim, disc_z):
    """Steel wheel: barrel, outer lips, dished disc with vent holes. disc_z = outer disc face (local)."""
    cx, cy, cz = center
    p.annulus(178, 192, width - 6, (cx, cy, cz), m_rim, seg=64)
    for s in (-1, 1):
        p.annulus(186, 200, 8, (cx, cy, cz + s * (width / 2 - 6)), m_rim, seg=64)
    p.cyl(182, 8, (cx, cy, disc_z - 4), m_rim, seg=64)  # disc
    p.cyl(80, 6, (cx, cy, disc_z - 9), m_rim, seg=40)  # hub pad
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        p.cyl(18, 1.2, (cx + 128 * math.cos(a), cy + 128 * math.sin(a), disc_z + 0.4), M["paint_dark"], seg=20)
    p.cyl(30, 1.2, (cx, cy, disc_z + 0.4), M["paint_dark"], seg=24)  # centre bore


# --------------------------------------------------------------------------------------------
# parts


def build_ground():
    p = Part("ground")
    p.box((6800, 20, 3500), L("ground", (-1600, -10, 150)), M["asphalt"])
    p.box((6800, 1, 100), L("ground", (-1600, 0.5, 1500)), M["line"])
    return p


def body_profile():
    """Side silhouette (world x, y) of the hatchback with both wheel arches."""
    pts = [(805, 205), (835, 330), (840, 520), (800, 650), (700, 730), (300, 815), (-320, 900), (-1150, 1410),
           (-1500, 1450), (-2650, 1445), (-3120, 1360), (-3300, 1150), (-3345, 900), (-3365, 520), (-3340, 240),
           (-3270, 205)]  # fmt: skip
    pts += arc(-2550, WC, 365, 199, -19, 20)[:]  # rear arch (over the top)
    pts += [(-2205, 150), (-365, 150)]  # sill between the wheels
    pts += arc(0, WC, 365, 199, -19, 20)
    pts = pts[8:] + pts[:8]  # start on the roof, so the polygon never closes across an arch
    # drop near-duplicates
    out = []
    for q in pts:
        if not out or math.hypot(q[0] - out[-1][0], q[1] - out[-1][1]) > 1:
            out.append(q)
    return out


def build_body():
    p = Part("body")
    o = POS["body"]
    prof = [(x - o[0], y - o[1]) for x, y in body_profile()]
    extrude_poly(p, prof, -850, 850, M["paint"])
    # cabin glass (sides, windshield, rear) slightly proud of the body
    win = [(-360, 930), (-1120, 1385), (-1500, 1420), (-2640, 1415), (-3080, 1340), (-3215, 1170), (-3230, 935)]
    win = [(x - o[0], y - o[1]) for x, y in win]
    for s in (-1, 1):
        extrude_poly(p, win, s * 850, s * 856, M["glass"])
    # B-pillar and door seams
    for x in (-1650,):
        for s in (-1, 1):
            p.box((70, 470, 8), L("body", (x, 1170, s * 857)), M["paint_dark"])
    for x in (-355, -1640, -2190):
        for s in (-1, 1):
            p.box((4, 700 if x != -2190 else 600, 2), L("body", (x, 560 if x != -2190 else 520, s * 851)), M["paint_dark"])
    # windshield and rear glass on the slopes
    def slope_glass(a, b, half):
        (x0, y0), (x1, y1) = a, b
        d = Vector((x1 - x0, y1 - y0, 0))
        n = Vector((-d.y, d.x, 0)).normalized() * 6
        bm = bmesh.new()
        q = [(x0, y0), (x1, y1)]
        vs = []
        for zz in (-half, half):
            for x, y in q:
                vs.append(bm.verts.new((x - o[0] + n.x, y - o[1] + n.y, zz)))
        bm.faces.new((vs[0], vs[1], vs[3], vs[2]))
        bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=4)
        p.add(bm, M["glass"])
    slope_glass((-330, 905), (-1130, 1400), 760)
    slope_glass((-3110, 1355), (-3290, 1160), 720)
    # lights, grille, bumpers
    for s in (-1, 1):
        p.box((40, 90, 260), L("body", (812, 600, s * 640)), M["light"], bevel=10)
        p.box((30, 40, 70), L("body", (812, 640, s * 790)), M["amber"], bevel=6)  # hazard / indicator
        p.box((30, 110, 200), L("body", (-3345, 1000, s * 700)), M["tail"], bevel=8)
        p.box((60, 30, 120), L("body", (-150, 860, s * 870)), M["paint_dark"], bevel=6)  # mirror arm
        p.box((140, 90, 30), L("body", (-180, 900, s * 905)), M["paint"], bevel=12)  # mirror
    p.box((30, 120, 900), L("body", (838, 420, 0)), M["paint_dark"], bevel=8)  # lower grille
    p.box((30, 60, 1600), L("body", (845, 260, 0)), M["paint_dark"], bevel=10)
    p.box((30, 60, 1600), L("body", (-3365, 300, 0)), M["paint_dark"], bevel=10)
    # sill trim and pinch-weld flange with the jack point (two notches, arrow mark)
    for s in (-1, 1):
        p.box((1830, 40, 20), L("body", (-1285, 170, s * 842)), M["paint_dark"])
    for x in (-520, -440):
        p.box((14, 14, 24), L("body", (x, 158, 842)), M["notch"])
    p.box((60, 10, 2), L("body", (-480, 240, 852)), M["notch"])  # mark on the sill side
    p.box((10, 30, 2), L("body", (-480, 220, 852)), M["notch"])
    # floor, suspension, inner arches
    p.box((3160, 40, 1080), L("body", (-1275, 170, 0)), M["paint_dark"])
    for x in (0, -2550):
        for s in (-1, 1):
            p.cyl(368, 10, L("body", (x, WC, s * 560)), M["paint_dark"], seg=48)  # arch liner backs
    # the other three wheels
    for x, z in ((-2550, 700), (0, -700), (-2550, -700)):
        c = L("body", (x, WC, z))
        s = 1 if z > 0 else -1
        tire(p, c, 195)
        steel_wheel(p, c, 195, M["steel"], c[2] + s * 6)
        p.cyl(185, 6, (c[0], c[1], c[2] + s * 40), M["cover"], seg=64)
    return p


def build_hub():
    p = Part("hub")
    loc = lambda w: L("hub", w)  # noqa: E731
    p.box((80, 80, 60), loc((0, WC, 570)), M["hub"], bevel=6)
    p.annulus(60, 140, 26, loc((0, WC, 614)), M["disc"], seg=64)
    p.cyl(72, 26, loc((0, WC, 614)), M["hub"], seg=48)
    p.cyl(70, 62, loc((0, WC, 659)), M["hub"], seg=48)  # hub flange 628..690
    p.cyl(36, 10, loc((0, WC, 685)), M["chrome"], seg=32)
    p.box((38, 118, 48), loc((-162, WC, 615)), M["caliper"], bevel=8)
    for k in range(5):
        a = math.radians(90 - k * 72)
        p.cyl(6, 38, loc((50 * math.cos(a), WC + 50 * math.sin(a), 709)), M["chrome"], seg=16)
    return p


def build_flat_tire():
    p = Part("flat_tire")
    c = L("flat_tire", (0, WC, 700))
    tire(p, c, 195, flat=True)
    steel_wheel(p, c, 195, M["steel"], 6.0)
    # puncture: a nail head in the tread, low at the front
    a = math.radians(-60)
    n = Vector((math.cos(a), math.sin(a), 0))
    head = Vector((158, -275 - WC + WC, 4)) + n * 4
    p.cyl(6, 3, (head.x, head.y, head.z), M["chrome"], axis="x", seg=12)
    return p


def build_spare_wheel():
    p = Part("spare_wheel")
    c = L("spare_wheel", (0, WC, 697.5))
    tire(p, c, 135)
    steel_wheel(p, c, 135, M["steel_dark"], 6.0)
    # yellow stripe on the outer sidewall (temporary use)
    p.annulus(262, 268, 2, (c[0], c[1], c[2] + 135 / 2 + 3.5), M["yellow"], seg=96)
    return p


def build_wheel_nuts():
    p = Part("wheel_nuts")
    for k in range(5):
        a = math.radians(90 - k * 72)
        x, y = 50 * math.cos(a), 50 * math.sin(a)
        p.cyl(7.5, 6, (x, y, 3), M["nut"], seg=24, r2=11.5)  # taper, narrow end toward the wheel
        p.cyl(12.5, 16, (x, y, 14), M["nut"], seg=6, smooth=False)  # hex 21-22 mm
        p.cyl(9, 0.8, (x, y, 22.2), M["chrome"], seg=24)
    return p


def build_wheel_cover():
    p = Part("wheel_cover")
    p.annulus(150, 185, 10, (0, 0, -27), M["cover"], seg=72)
    p.cyl(185, 34, (0, 0, -6), M["cover"], seg=72, r2=125)
    p.cyl(125, 8, (0, 0, 15), M["cover"], seg=72, r2=70)
    p.cyl(70, 12, (0, 0, 25), M["chrome"], seg=48)
    for k in range(10):
        a = 2 * math.pi * k / 10
        p.box((40, 9, 2), (150 * math.cos(a), 150 * math.sin(a), 12), M["paint_dark"], rot=(0, 0, math.degrees(a)))
    return p


def build_jack():
    p = Part("jack")
    p.box((180, 20, 100), (0, 10, 0), M["jack"], bevel=4)
    for z in (-18, 18):
        for a, b in (((0, 30), (80, 85)), ((0, 30), (-80, 85)), ((80, 85), (0, 138)), ((-80, 85), (0, 138))):
            p.pipe([(a[0], a[1], z), (b[0], b[1], z)], 6, M["jack"], seg=10)
    p.cyl(8, 50, (0, 30, 0), M["jack"], seg=16)
    p.cyl(8, 50, (0, 138, 0), M["jack"], seg=16)
    for x in (-80, 80):
        p.cyl(9, 50, (x, 85, 0), M["jack_hi"], seg=16)
    p.cyl(4.5, 230, (0, 85, 0), M["jack_hi"], axis="x", seg=14)  # screw
    p.cyl(10, 18, (-122, 85, 0), M["jack_hi"], axis="x", seg=18)  # crank eye
    p.box((60, 6, 40), (0, 143, 0), M["jack"])  # saddle
    for z in (-17, 17):
        p.box((60, 6, 6), (0, 147, z), M["jack"])  # groove lips (the flange sits between)
    return p


def build_wrench():
    p = Part("wrench")
    loc = lambda w: L("wrench", w)  # noqa: E731
    p.pipe([loc((170, 11, 1000)), loc((480, 11, 1000))], 9, M["wrench"], seg=12)
    p.box((40, 6, 22), loc((490, 6, 1000)), M["wrench"], bevel=2)  # cap-lever end
    p.cyl(18, 34, loc((150, 21, 1000)), M["wrench"], axis="y", seg=24)
    p.cyl(12, 1, loc((150, 38.6, 1000)), M["paint_dark"], axis="y", seg=6)
    return p


def build_chock():
    p = Part("chock")
    o = POS["chock"]
    for sgn, x0 in ((1, -2233), (-1, -2867)):
        prof = [(x0, 0), (x0 + sgn * 140, 0), (x0 + sgn * 130, 18), (x0 + sgn * 30, 104), (x0, 110)]
        if sgn < 0:
            prof = list(reversed(prof))
        extrude_poly(p, [(x - o[0], y - o[1]) for x, y in prof], -60, 60, M["chock"])
    return p


def build_triangle():
    p = Part("triangle")
    loc = lambda w: L("triangle", w)  # noqa: E731
    for z in (650, 750):
        p.box((300, 8, 14), loc((-4300, 4, z)), M["tri_frame"])
    p.box((20, 14, 30), loc((-4300, 14, 700)), M["tri_frame"])
    tri = [(-4300, 36, 486), (-4300, 36, 914), (-4300, 414, 700)]
    tri = [loc(v) for v in tri]
    p.pipe(tri + [tri[0]], 9, M["tri_red"], seg=10)
    inner = [(-4300, 80, 560), (-4300, 80, 840), (-4300, 330, 700)]
    inner = [loc(v) for v in inner]
    p.pipe(inner + [inner[0]], 4, M["tri_red"], seg=8)
    return p


BUILDERS = {
    "ground": build_ground, "body": build_body, "hub": build_hub, "flat_tire": build_flat_tire,
    "spare_wheel": build_spare_wheel, "wheel_nuts": build_wheel_nuts, "wheel_cover": build_wheel_cover,
    "jack": build_jack, "wrench": build_wrench, "chock": build_chock, "triangle": build_triangle,
}  # fmt: skip


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
    reset_scene()
    mats()
    coll = bpy.data.collections.new("car_tire")
    bpy.context.scene.collection.children.link(coll)
    objs = {}
    for pid in PART_IDS:
        objs[pid] = BUILDERS[pid]().finish(coll, POS[pid])

    feats = {f["id"]: f for f in PROD["features"]}
    layout = {"units": "mm", "source": "packages/products/blender/build_car_tire.py", "parts": {}, "features": {}}
    for p in PROD["parts"]:
        ob = objs[p["id"]]
        vs = [v.co for v in ob.data.vertices]
        lo = [min(v[i] for v in vs) for i in range(3)]
        hi = [max(v[i] for v in vs) for i in range(3)]
        layout["parts"][p["id"]] = {
            "position": list(p["position"]),
            "rotation": [0, 0, 0],
            "bounds": {"size": [round(hi[i] - lo[i], 2) for i in range(3)],
                       "center": [round((hi[i] + lo[i]) / 2, 2) for i in range(3)]},  # fmt: skip
            "boxes": p["geometry"]["boxes"],
            "triangles": sum(len(pl.vertices) - 2 for pl in ob.data.polygons),
        }
        # coarse boxes vs mesh: how far the mesh pokes out of the boxes' union bounds (mm)
        bl = [min(b["position"][i] - b["size"][i] / 2 for b in p["geometry"]["boxes"]) for i in range(3)]
        bh = [max(b["position"][i] + b["size"][i] / 2 for b in p["geometry"]["boxes"]) for i in range(3)]
        poke = max(max(bl[i] - lo[i], hi[i] - bh[i]) for i in range(3))
        print(f"[mesh] {p['id']:<12} tris={layout['parts'][p['id']]['triangles']:>6} pokes out of boxes by {poke:.1f} mm")
    for fid, f in feats.items():
        layout["features"][fid] = {"partId": f["partId"], "position": list(f["position"])}
    with open(LAYOUT_OUT, "w") as fh:
        json.dump(layout, fh, indent=1, ensure_ascii=False)
    print("[layout] wrote", LAYOUT_OUT)
    if "--no-export" not in ARGS:
        export_glb(objs)
    if "--preview" in ARGS:
        render_previews(objs)


def export_glb(objs):
    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob.name in PART_IDS)
    bpy.context.view_layer.objects.active = objs["body"]
    bpy.ops.export_scene.gltf(
        filepath=GLB_OUT, export_format="GLB", use_selection=True, export_yup=False, export_apply=True,
        export_texcoords=False, export_normals=True, export_materials="EXPORT", export_cameras=False,
        export_lights=False, export_extras=False, export_animations=False,
    )  # fmt: skip
    import struct

    data = open(GLB_OUT, "rb").read()
    n = struct.unpack_from("<I", data, 12)[0]
    gj = json.loads(data[20 : 20 + n])
    names = {nd.get("name") for nd in gj.get("nodes", [])}
    missing = [pid for pid in PART_IDS if pid not in names]
    print(f"[glb] wrote {GLB_OUT} ({len(data) / 1e6:.2f} MB), nodes={len(gj['nodes'])}, missing={missing or 'none'}")


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
    sc.render.resolution_x, sc.render.resolution_y = 1400, 900
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    world = bpy.data.worlds.get("preview") or bpy.data.worlds.new("preview")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.75, 0.78, 0.82, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = world
    try:
        sc.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    for name, loc, energy, size in (("key", (2500, 4000, 4000), 9.0e8, 3000), ("fill", (-4000, 2000, 3000), 3.0e8, 3000),
                                     ("rim", (-1000, 3000, -4000), 2.5e8, 3000)):  # fmt: skip
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lo)
        look_at(lo, loc, (-1300, 300, 300))
    cd = bpy.data.cameras.new("cam")
    cd.lens = 45
    cd.clip_start = 10
    cd.clip_end = 40000
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tools = ["spare_wheel", "jack", "wrench", "chock", "triangle"]
    states = {
        "assembled": set(PART_IDS) - set(tools),
        "changing": set(PART_IDS) - {"flat_tire", "wheel_cover"},
    }
    shots = [
        ("assembled", "full", (2900, 1900, 4300), (-1300, 350, 300)),
        ("assembled", "wheel", (1100, 700, 2300), (0, WC, 700)),
        ("changing", "full", (2900, 1900, 4300), (-1300, 350, 300)),
        ("changing", "wheel", (1100, 700, 2300), (0, WC, 650)),
        ("changing", "jack", (-150, 260, 2000), (-480, 120, 830)),
        ("changing", "rear", (-6300, 1500, 2800), (-2600, 300, 0)),
    ]
    for state, name, pos, tgt in shots:
        for pid, ob in objs.items():
            ob.hide_render = pid not in states[state]
        look_at(cam, pos, tgt)
        sc.render.filepath = os.path.join(PREVIEW_DIR, f"car_tire_{state}_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[preview] {sc.render.filepath}")
    for ob in objs.values():
        ob.hide_render = False


main()
