"""Build the student simple-distillation setup (assembled) and export the GLB + layout.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python build_distill_setup.py [-- --preview] [-- --no-export]

Outputs
- apps/web/public/models/distill_setup.glb            one top-level node per part ID, mesh in part-local mm
- packages/products/blender/distill_setup.layout.json  part positions, coarse boxes, feature positions
- packages/products/blender/previews/distill_setup_*.png  (with --preview) EEVEE renders

Axes are the engine's: +Y up, +X from the flask (left) to the receiver (right), +Z toward the viewer.
Bench top is y = 0. 1 unit = 1 mm. All parts keep rotation [0, 0, 0]; tilted glass (side arm,
condenser, adapter) is modelled tilted in the mesh, and its coarse boxes are short segments so the
AABBs stay tight.
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
import importlib  # noqa: E402

import lib  # noqa: E402

importlib.reload(lib)
from lib import Part, mat, xf  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GLB_OUT = os.path.join(ROOT, "apps", "web", "public", "models", "distill_setup.glb")
LAYOUT_OUT = os.path.join(HERE, "distill_setup.layout.json")
PREVIEW_DIR = os.path.join(HERE, "previews")

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

PART_IDS = [
    "bench", "stand_flask", "heating_mantle", "flask", "flask_clamp", "liquid", "boiling_chips", "stopper",
    "thermometer", "stand_cond", "condenser", "cond_clamp", "hose_out", "hose_in", "adapter", "receiver",
]  # fmt: skip

# --------------------------------------------------------------------------------------------
# palette: glass is tinted and fairly visible (alpha 0.32) so it does not read as the engine's ghost

M = dict(
    bench=mat("bench_top", "#d9d4c7", 0.0, 0.7),
    bench_edge=mat("bench_edge", "#6f6a5f", 0.0, 0.6),
    steel=mat("stand_steel", "#9aa1a9", 0.85, 0.32),
    stand_base=mat("stand_base", "#3b4048", 0.4, 0.45),
    clamp=mat("clamp_metal", "#b8bec6", 0.8, 0.3),
    clamp_pad=mat("clamp_pad", "#c0392b", 0.0, 0.8),
    knob=mat("knob_black", "#202226", 0.1, 0.5),
    mantle=mat("mantle_body", "#5d7286", 0.3, 0.45),
    mantle_bowl=mat("mantle_bowl", "#e9e4d6", 0.0, 0.9),
    led=mat("mantle_led", "#ff7a3d", 0.0, 0.3, emission="#ff6a2a", emission_strength=3.0),
    glass=mat("lab_glass", "#cfe7f2", 0.0, 0.05, alpha=0.32),
    glass_rim=mat("lab_glass_rim", "#b7d6e4", 0.0, 0.08, alpha=0.6),
    water=mat("cooling_water", "#7fc4ec", 0.0, 0.1, alpha=0.38),
    liquid=mat("sample_liquid", "#e8a33b", 0.0, 0.15, alpha=0.82),
    chips=mat("boiling_chip", "#f4f1ea", 0.0, 0.95),
    rubber=mat("rubber_stopper", "#8a3324", 0.0, 0.75),
    therm_glass=mat("therm_glass", "#eef5f8", 0.0, 0.1, alpha=0.7),
    therm_red=mat("therm_liquid", "#d6262c", 0.0, 0.3),
    therm_scale=mat("therm_scale", "#2a2d33", 0.0, 0.5),
    hose=mat("hose_rubber", "#d9935a", 0.0, 0.6),
    hose_in_band=mat("hose_in_band", "#2b7bd6", 0.0, 0.4),
    hose_out_band=mat("hose_out_band", "#d9422b", 0.0, 0.4),
)

# --------------------------------------------------------------------------------------------
# layout (world mm)

SLOPE = 12.0  # side arm and condenser go down this many degrees from horizontal
DIR = Vector((math.cos(math.radians(SLOPE)), -math.sin(math.radians(SLOPE)), 0))
NRM = Vector((math.sin(math.radians(SLOPE)), math.cos(math.radians(SLOPE)), 0))  # perpendicular, up-ish

FLASK_X = -200.0
BULB_C = Vector((FLASK_X, 115.0, 0))
BULB_R = 42.0
NECK_R = 13.0
NECK_TOP = 290.0
ARM_Y = 245.0
ARM_R = 4.5
ARM0 = Vector((FLASK_X + NECK_R - 1.0, ARM_Y, 0))  # side arm leaves the neck here
ARM_LEN = 118.0
C0 = ARM0 + DIR * 88.0  # condenser inlet (vapor in)
COND_LEN = 300.0
JACKET = (25.0, 275.0)
JACKET_R = 15.0
INNER_R = 7.0
NOZ_HIGH_U, NOZ_LOW_U = 40.0, 260.0
NOZ_LEN = 30.0  # from the condenser axis


def Q(u):
    return C0 + DIR * u


MANTLE_TOP = 95.0
BOWL_R = 46.0
BULB_BOTTOM = BULB_C.y - BULB_R  # 73
LIQ_TOP = 104.0  # below the bulb's widest point: less than half full
STOP_Y = (272.0, 302.0)
THERM_BULB = (229.5, 241.5)  # bulb top level with the bottom of the side arm opening
THERM_TOP = 530.0
ROD_Z = -120.0
ROD_TOP = 600.0
CLAMP_Y = 195.0
COND_CLAMP_U = 150.0
ADAPT = (285.0, 325.0)
ADAPT_TIP_Y = 106.0
RECV_X = Q(ADAPT[1]).x
RECV_H, RECV_NECK = 105.0, 135.0

ORIGIN = {
    "bench": (0, 0, 0),
    "stand_flask": (FLASK_X, 0, ROD_Z),
    "heating_mantle": (FLASK_X, 0, 0),
    "flask": tuple(BULB_C),
    "flask_clamp": (FLASK_X, CLAMP_Y, 0),
    "liquid": (FLASK_X, BULB_BOTTOM, 0),
    "boiling_chips": (FLASK_X, BULB_BOTTOM, 0),
    "stopper": (FLASK_X, STOP_Y[0], 0),
    "thermometer": (FLASK_X, THERM_BULB[0], 0),
    "stand_cond": (Q(COND_CLAMP_U).x, 0, ROD_Z),
    "condenser": tuple(C0),
    "cond_clamp": tuple(Q(COND_CLAMP_U)),
    "hose_out": tuple(Q(NOZ_HIGH_U) + NRM * NOZ_LEN),
    "hose_in": tuple(Q(NOZ_LOW_U) - NRM * NOZ_LEN),
    "adapter": tuple(Q(ADAPT[0])),
    "receiver": (RECV_X, 0, 0),
}
ORIGIN = {k: tuple(round(float(c), 3) for c in v) for k, v in ORIGIN.items()}


def world(pid):
    """Draw in world coordinates inside this frame; the mesh ends up part-local."""
    return xf(tuple(-c for c in ORIGIN[pid]))


# --------------------------------------------------------------------------------------------
# helpers


def sphere_y(p, r, pos, m, seg=32, rings=18, y_max=None, y_min=None):
    """UV sphere with poles on Y, optionally flattened above y_max / below y_min (local to pos)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, "X"))
    for v in bm.verts:
        if y_max is not None and v.co.y > y_max:
            v.co.y = y_max
        if y_min is not None and v.co.y < y_min:
            v.co.y = y_min
    for f in bm.faces:
        f.smooth = True
    p.add(bm, m, xf(pos))


def seg_boxes(p, a, b, r, n, color):
    """Coarse AABBs for a straight tube a->b of radius r, split into n segments."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ext = [r * math.sqrt(max(0.0, 1 - d[i] ** 2)) for i in range(3)]
    for k in range(n):
        s0, s1 = a.lerp(b, k / n), a.lerp(b, (k + 1) / n)
        lo = [min(s0[i], s1[i]) - ext[i] for i in range(3)]
        hi = [max(s0[i], s1[i]) + ext[i] for i in range(3)]
        p.coarse([hi[i] - lo[i] for i in range(3)], [(hi[i] + lo[i]) / 2 for i in range(3)], color)


def box_mm(p, lo, hi, color):
    p.coarse([hi[i] - lo[i] for i in range(3)], [(hi[i] + lo[i]) / 2 for i in range(3)], color)


def path_boxes(p, pts, r, color, n_per=1):
    for a, b in zip(pts, pts[1:]):
        seg_boxes(p, a, b, r, n_per, color)


# --------------------------------------------------------------------------------------------
# parts


def build_bench():
    p = Part("bench")
    with p.at(world("bench")):
        p.box((900, 26, 560), (-10, -13, 0), M["bench"], bevel=2)
        p.box((900, 6, 560), (-10, -29, 0), M["bench_edge"])
        box_mm(p, (-460, -32, -280), (440, 0, 280), "#d9d4c7")
    return p


def build_stand(pid, x):
    p = Part(pid)
    with p.at(world(pid)):
        p.box((120, 12, 140), (x, 6, ROD_Z - 25), M["stand_base"], bevel=3)
        p.cyl(6, ROD_TOP - 12, (x, 12 + (ROD_TOP - 12) / 2, ROD_Z), M["steel"], axis="y", seg=20)
        p.cyl(7, 4, (x, 14, ROD_Z), M["steel"], axis="y", seg=20)
        box_mm(p, (x - 60, 0, ROD_Z - 95), (x + 60, 12, ROD_Z + 45), "#3b4048")
        box_mm(p, (x - 6, 12, ROD_Z - 6), (x + 6, ROD_TOP, ROD_Z + 6), "#9aa1a9")
    return p


def build_mantle():
    p = Part("heating_mantle")
    x = FLASK_X
    with p.at(world("heating_mantle")):
        p.cyl(75, MANTLE_TOP - 8, (x, (MANTLE_TOP - 8) / 2, 0), M["mantle"], axis="y", seg=40)
        p.cyl(76, 8, (x, MANTLE_TOP - 4, 0), M["mantle"], axis="y", seg=40)
        # bowl lining (cloth) visible from above
        sphere_y(p, BOWL_R, (x, BULB_C.y, 0), M["mantle_bowl"], y_max=MANTLE_TOP + 0.4 - BULB_C.y,
                 y_min=BULB_BOTTOM - 0.5 - BULB_C.y)  # fmt: skip
        # control knob and lamp on the front
        p.cyl(10, 10, (x - 20, 35, 80), M["knob"], axis="z", seg=20)
        p.box((3, 12, 2), (x - 20, 35, 85.5), M["clamp"])
        p.cyl(4, 4, (x + 25, 35, 76), M["led"], axis="z", seg=12)
        p.feature("mantle_switch", (x - 20, 35, 85))
        # coarse: solid base under the bowl, then a ring of four walls around it
        box_mm(p, (x - 75, 0, -75), (x + 75, BULB_BOTTOM, 75), "#5d7286")
        for lo, hi in (
            ((x - 75, BULB_BOTTOM, -75), (x - BOWL_R, MANTLE_TOP, 75)),
            ((x + BOWL_R, BULB_BOTTOM, -75), (x + 75, MANTLE_TOP, 75)),
            ((x - BOWL_R, BULB_BOTTOM, BOWL_R), (x + BOWL_R, MANTLE_TOP, 75)),
            ((x - BOWL_R, BULB_BOTTOM, -75), (x + BOWL_R, MANTLE_TOP, -BOWL_R)),
        ):
            box_mm(p, lo, hi, "#5d7286")
        box_mm(p, (x - 30, 25, 75), (x - 10, 45, 85), "#202226")
    return p


def build_flask():
    p = Part("flask")
    x = FLASK_X
    with p.at(world("flask")):
        sphere_y(p, BULB_R, tuple(BULB_C), M["glass"], seg=40, rings=22)
        neck_bot = BULB_C.y + BULB_R - 6
        p.annulus(NECK_R - 1.6, NECK_R, NECK_TOP - neck_bot, (x, (NECK_TOP + neck_bot) / 2, 0), M["glass"], axis="y")
        p.annulus(NECK_R - 1.6, NECK_R + 1.5, 4, (x, NECK_TOP - 2, 0), M["glass_rim"], axis="y")
        arm_end = ARM0 + DIR * ARM_LEN
        p.pipe([ARM0 - DIR * 2, arm_end], ARM_R, M["glass"], seg=14)
        # features
        p.feature("flask_neck", (x, NECK_TOP, 0))
        p.feature("flask_side_arm", tuple(ARM0 + DIR * 12))  # a little out along the arm, so its pin clears the bulb pin
        p.feature("flask_fill_line", (x + BULB_R, BULB_C.y, 0))
        p.feature("flask_bottom", (x, BULB_BOTTOM + 1, 0))
        # coarse
        box_mm(p, (x - BULB_R, BULB_BOTTOM, -BULB_R), (x + BULB_R, BULB_C.y + BULB_R, BULB_R), "#cfe7f2")
        box_mm(p, (x - NECK_R - 1.5, BULB_C.y + BULB_R, -NECK_R - 1.5), (x + NECK_R + 1.5, NECK_TOP, NECK_R + 1.5), "#cfe7f2")
        seg_boxes(p, ARM0, arm_end, ARM_R, 4, "#cfe7f2")
    return p


def build_liquid():
    p = Part("liquid")
    x = FLASK_X
    with p.at(world("liquid")):
        r = BULB_R - 2.2
        sphere_y(p, r, tuple(BULB_C), M["liquid"], seg=36, rings=20, y_max=LIQ_TOP - BULB_C.y)
        half = math.sqrt(r * r - (LIQ_TOP - BULB_C.y) ** 2)
        lo_y = BULB_C.y - r
        box_mm(p, (x - half, lo_y, -half), (x + half, LIQ_TOP, half), "#e8a33b")
        p.feature("liquid_surface", (x, LIQ_TOP, 0))
    return p


def build_chips():
    p = Part("boiling_chips")
    x, y = FLASK_X, BULB_BOTTOM + 2.2
    with p.at(world("boiling_chips")):
        for i, (dx, dz, s) in enumerate(((-6, 3, 4.2), (5, -4, 3.6), (1, 8, 3.2))):
            p.box((s, s * 0.8, s * 1.1), (x + dx, y + 1.6 + s * 0.4, dz), M["chips"], bevel=0.8, rot=(10 * i, 25 * i, 5))
        box_mm(p, (x - 9, y, -7), (x + 8, y + 6, 11), "#f4f1ea")
        p.feature("chips_in_flask", (x, y + 3, 2))
    return p


def build_stopper():
    p = Part("stopper")
    x = FLASK_X
    with p.at(world("stopper")):
        h = STOP_Y[1] - STOP_Y[0]
        p.cyl(NECK_R - 1.8, h, (x, (STOP_Y[0] + STOP_Y[1]) / 2, 0), M["rubber"], axis="y", seg=28, r2=NECK_R + 1.2)
        box_mm(p, (x - NECK_R - 1.2, STOP_Y[0], -NECK_R - 1.2), (x + NECK_R + 1.2, STOP_Y[1], NECK_R + 1.2), "#8a3324")
        p.feature("stopper_hole", (x, STOP_Y[1], 0))
    return p


def build_thermometer():
    p = Part("thermometer")
    x = FLASK_X
    b0, b1 = THERM_BULB
    with p.at(world("thermometer")):
        # bulb (red), stem glass, red column and a dark scale
        p.cyl(3.0, b1 - b0 - 2, (x, (b0 + b1) / 2 + 1, 0), M["therm_red"], axis="y", seg=16)
        sphere_y(p, 3.0, (x, b0 + 3, 0), M["therm_red"], seg=16, rings=8)
        p.cyl(3.5, THERM_TOP - b1, (x, (THERM_TOP + b1) / 2, 0), M["therm_glass"], axis="y", seg=16)
        p.cyl(0.9, 140, (x, b1 + 70, 0), M["therm_red"], axis="y", seg=8)
        for k in range(14):
            yy = STOP_Y[1] + 20 + k * 14
            p.box((4.0 if k % 5 == 0 else 2.4, 0.6, 0.4), (x + 1.2, yy, 3.4), M["therm_scale"])
        sphere_y(p, 3.5, (x, THERM_TOP, 0), M["therm_glass"], seg=16, rings=8)
        box_mm(p, (x - 3.5, b0, -3.5), (x + 3.5, THERM_TOP + 3.5, 3.5), "#eef5f8")
        p.feature("therm_bulb_tip", (x, b1, 0))
    return p


def build_condenser():
    p = Part("condenser")
    with p.at(world("condenser")):
        j0, j1 = Q(JACKET[0]), Q(JACKET[1])
        # outer jacket with tapered ends, inner tube, cooling water between them
        p.pipe([j0, j1], JACKET_R, M["glass"], seg=28)
        p.pipe([Q(JACKET[0] + 1), Q(JACKET[1] - 1)], JACKET_R - 1.8, M["water"], seg=24)
        p.pipe([Q(0), Q(COND_LEN)], INNER_R, M["glass_rim"], seg=18)
        for u in (JACKET[0], JACKET[1]):
            p.pipe([Q(u - 6), Q(u + 0.5)] if u == JACKET[0] else [Q(u - 0.5), Q(u + 6)], INNER_R + 3, M["glass"], seg=18)
        # water nozzles: high one points up (out), low one points down (in)
        hi0, lo0 = Q(NOZ_HIGH_U), Q(NOZ_LOW_U)
        p.pipe([hi0 + NRM * (JACKET_R - 2), hi0 + NRM * NOZ_LEN], 4.0, M["glass_rim"], seg=12)
        p.pipe([lo0 - NRM * (JACKET_R - 2), lo0 - NRM * NOZ_LEN], 4.0, M["glass_rim"], seg=12)
        # small ridge where the hose grips
        p.pipe([hi0 + NRM * (NOZ_LEN - 6), hi0 + NRM * (NOZ_LEN - 3)], 4.8, M["glass_rim"], seg=12)
        p.pipe([lo0 - NRM * (NOZ_LEN - 6), lo0 - NRM * (NOZ_LEN - 3)], 4.8, M["glass_rim"], seg=12)
        p.feature("cond_vapor_in", tuple(Q(0)))
        p.feature("cond_water_out_high", tuple(hi0 + NRM * NOZ_LEN))
        p.feature("cond_water_in_low", tuple(lo0 - NRM * NOZ_LEN))
        p.feature("cond_outlet", tuple(Q(COND_LEN)))
        # coarse
        seg_boxes(p, Q(0), Q(JACKET[0]), INNER_R + 3, 1, "#b7d6e4")
        seg_boxes(p, j0, j1, JACKET_R, 6, "#cfe7f2")
        seg_boxes(p, Q(JACKET[1]), Q(COND_LEN), INNER_R + 3, 1, "#b7d6e4")
        seg_boxes(p, hi0 + NRM * JACKET_R, hi0 + NRM * NOZ_LEN, 4.0, 1, "#cfe7f2")
        seg_boxes(p, lo0 - NRM * JACKET_R, lo0 - NRM * NOZ_LEN, 4.0, 1, "#cfe7f2")
    return p


def build_clamp(pid, center, grip_r, rod_x):
    """Three-finger clamp: boss on the rod (z = ROD_Z), arm along +Z, jaws around a tube at `center`."""
    p = Part(pid)
    c = Vector(center)
    with p.at(world(pid)):
        # boss with thumb screw
        p.box((24, 24, 24), (rod_x, c.y, ROD_Z), M["clamp"], bevel=2)
        p.cyl(4, 22, (rod_x - 20, c.y, ROD_Z), M["knob"], axis="x", seg=14)
        # arm
        arm_z0, arm_z1 = ROD_Z + 12, c.z - grip_r - 6
        p.cyl(5, arm_z1 - arm_z0, (rod_x, c.y, (arm_z0 + arm_z1) / 2), M["clamp"], axis="z", seg=16)
        # bend the arm over to the tube if it is not right above the rod
        dx = c.x - rod_x
        if abs(dx) > 1:
            p.box((abs(dx) + 10, 8, 8), (rod_x + dx / 2, c.y, arm_z1), M["clamp"])
        # jaws (two curved pads approximated by boxes) and a wing screw
        jw = grip_r + 4
        p.box((2 * jw + 4, 14, 6), (c.x, c.y, c.z - grip_r - 3), M["clamp"], bevel=1)
        p.box((6, 14, 2 * grip_r + 6), (c.x - jw, c.y, c.z), M["clamp"], bevel=1)
        p.box((6, 14, 2 * grip_r + 6), (c.x + jw, c.y, c.z), M["clamp"], bevel=1)
        p.box((2.5, 12, 2 * grip_r), (c.x - grip_r - 0.6, c.y, c.z), M["clamp_pad"])
        p.box((2.5, 12, 2 * grip_r), (c.x + grip_r + 0.6, c.y, c.z), M["clamp_pad"])
        p.cyl(3, 16, (c.x + jw + 10, c.y, c.z), M["knob"], axis="x", seg=12)
        p.feature(f"{pid}_jaw", (c.x, c.y, c.z + grip_r))
        box_mm(p, (rod_x - 12, c.y - 12, ROD_Z - 12), (rod_x + 12, c.y + 12, ROD_Z + 12), "#b8bec6")
        box_mm(p, (min(rod_x, c.x) - 5, c.y - 5, ROD_Z + 12), (max(rod_x, c.x) + 5, c.y + 5, arm_z1 + 4), "#b8bec6")
        box_mm(p, (c.x - jw - 3, c.y - 7, c.z - grip_r - 6), (c.x + jw + 18, c.y + 7, c.z + grip_r + 3), "#b8bec6")
    return p


def hose_points(start, out_dir, back_y):
    s = Vector(start)
    a = s + out_dir * 22
    b = Vector((a.x, back_y, -70))
    c = Vector((a.x, 30, -215))
    d = Vector((a.x, 5.6, -250))
    return [s - out_dir * 12, a, b, c, d]


def build_hose(pid, tip, out_dir, band_m, back_y):
    p = Part(pid)
    with p.at(world(pid)):
        pts = hose_points(tip, out_dir, back_y)
        p.pipe(pts, 5.5, M["hose"], bend=40, seg=14)
        # coloured band near the nozzle: blue = water in, red = water out
        s = Vector(tip)
        p.pipe([s + out_dir * 1, s + out_dir * 9], 6.2, band_m, seg=14)
        p.feature(f"{pid}_end", tuple(s))
        path_boxes(p, [pts[0], pts[1]], 6.2, "#e0a36c")
        # bent part: coarse boxes along the filleted line
        fl = lib.fillet(pts[1:], 40)
        dense = [fl[0]] + [fl[i] for i in range(2, len(fl), 2)] + [fl[-1]]
        path_boxes(p, dense, 5.5, "#e0a36c")
    return p


def build_adapter():
    p = Part("adapter")
    with p.at(world("adapter")):
        a0, a1 = Q(ADAPT[0]), Q(ADAPT[1])
        tip = Vector((a1.x, ADAPT_TIP_Y, 0))
        p.pipe([a0, a1, tip], 6.0, M["glass"], bend=14, seg=18)
        p.pipe([a0 - DIR * 1, a0 + DIR * 14], 10.5, M["glass_rim"], seg=18)
        p.feature("adapter_tip", tuple(tip))
        seg_boxes(p, a0, a0 + DIR * 14, 10.5, 1, "#b7d6e4")
        fl = lib.fillet([a0 + DIR * 14, a1, tip], 14)
        dense = [fl[0]] + [fl[i] for i in range(2, len(fl), 2)] + [fl[-1]]
        path_boxes(p, dense, 6.0, "#cfe7f2")
    return p


def build_receiver():
    p = Part("receiver")
    x = RECV_X
    with p.at(world("receiver")):
        p.cyl(45, RECV_H, (x, RECV_H / 2, 0), M["glass"], axis="y", seg=40, r2=16, smooth=True)
        p.annulus(13.5, 15.5, RECV_NECK - RECV_H + 4, (x, (RECV_NECK + RECV_H - 4) / 2, 0), M["glass"], axis="y")
        p.annulus(13.5, 17.0, 3, (x, RECV_NECK - 1.5, 0), M["glass_rim"], axis="y")
        p.cyl(43, 6, (x, 3.5, 0), M["liquid"], axis="y", seg=32)  # a little distillate
        p.feature("receiver_mouth", (x, RECV_NECK, 0))
        box_mm(p, (x - 45, 0, -45), (x + 45, RECV_H, 45), "#cfe7f2")
        box_mm(p, (x - 17, RECV_H, -17), (x + 17, RECV_NECK, 17), "#cfe7f2")
    return p


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


def build_all():
    return {
        "bench": build_bench(),
        "stand_flask": build_stand("stand_flask", FLASK_X),
        "heating_mantle": build_mantle(),
        "flask": build_flask(),
        "flask_clamp": build_clamp("flask_clamp", (FLASK_X, CLAMP_Y, 0), NECK_R, FLASK_X),
        "liquid": build_liquid(),
        "boiling_chips": build_chips(),
        "stopper": build_stopper(),
        "thermometer": build_thermometer(),
        "stand_cond": build_stand("stand_cond", ORIGIN["stand_cond"][0]),
        "condenser": build_condenser(),
        "cond_clamp": build_clamp("cond_clamp", ORIGIN["cond_clamp"], JACKET_R, ORIGIN["stand_cond"][0]),
        "hose_out": build_hose("hose_out", ORIGIN["hose_out"], NRM, M["hose_out_band"], 300),
        "hose_in": build_hose("hose_in", ORIGIN["hose_in"], -NRM, M["hose_in_band"], 90),
        "adapter": build_adapter(),
        "receiver": build_receiver(),
    }


def main():
    reset_scene()
    coll = bpy.data.collections.new("distill_setup")
    bpy.context.scene.collection.children.link(coll)
    parts = build_all()
    objs = {}
    for pid in PART_IDS:
        part = parts[pid]
        ob = part.finish(coll, ORIGIN[pid])
        objs[pid] = ob
        for fid, pos in part.features.items():
            e = bpy.data.objects.new(fid, None)
            e.empty_display_type = "SPHERE"
            e.empty_display_size = 2.0
            e.parent = ob
            e.location = pos
            coll.objects.link(e)

    layout = {"units": "mm", "source": "packages/products/blender/build_distill_setup.py", "parts": {}, "features": {}}
    for pid in PART_IDS:
        ob, part = objs[pid], parts[pid]
        vs = [v.co for v in ob.data.vertices]
        lo = [min(v[i] for v in vs) for i in range(3)]
        hi = [max(v[i] for v in vs) for i in range(3)]
        layout["parts"][pid] = {
            "position": list(ORIGIN[pid]),
            "rotation": [0, 0, 0],
            "bounds": {"size": [round(hi[i] - lo[i], 2) for i in range(3)],
                       "center": [round((hi[i] + lo[i]) / 2, 2) for i in range(3)]},  # fmt: skip
            "boxes": part.boxes,
            "triangles": sum(len(pl.vertices) - 2 for pl in ob.data.polygons),
        }
        for fid, pos in part.features.items():
            layout["features"][fid] = {"partId": pid, "position": [round(float(c), 3) for c in pos]}
    with open(LAYOUT_OUT, "w") as f:
        json.dump(layout, f, indent=1, ensure_ascii=False)
    print(f"[layout] wrote {LAYOUT_OUT}: {len(layout['parts'])} parts, {len(layout['features'])} features")

    if "--no-export" not in ARGS:
        export_glb(objs)
    if "--preview" in ARGS:
        render_previews(objs)


def export_glb(objs):
    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob.type == "MESH")
    bpy.context.view_layer.objects.active = objs["bench"]
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
    size = os.path.getsize(GLB_OUT)
    print(f"[glb] wrote {GLB_OUT} ({size / 1e6:.2f} MB)")
    import struct

    with open(GLB_OUT, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 12)[0]
    gj = json.loads(data[20 : 20 + n])
    names = {nd.get("name") for nd in gj.get("nodes", [])}
    missing = [pid for pid in PART_IDS if pid not in names]
    print("[glb] all part nodes present" if not missing else f"[glb] MISSING nodes: {missing}")


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
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
    try:
        sc.eevee.taa_render_samples = 48
    except AttributeError:
        pass
    wd = bpy.data.worlds.get("preview") or bpy.data.worlds.new("preview")
    wd.use_nodes = True
    bg = next(n for n in wd.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.78, 0.8, 0.83, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = wd
    try:
        sc.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    for name, loc, energy, size in (("key", (600, 900, 900), 6.0e6, 600), ("fill", (-700, 400, 600), 2.5e6, 800),
                                     ("rim", (100, 800, -700), 2.0e6, 500)):  # fmt: skip
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lo)
        look_at(lo, loc, (0, 200, 0))
    cd = bpy.data.cameras.new("cam")
    cd.lens = 50
    cd.clip_start = 10
    cd.clip_end = 10000
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    shots = {
        "full_34": ((200, 520, 1250), (-10, 230, 0)),
        "front": ((-10, 280, 1300), (-10, 260, 0)),
        "thermo_close": ((-90, 300, 330), (-200, 245, 0)),
        "condenser_close": ((120, 330, 520), (40, 180, 0)),
        "flask_close": ((-80, 230, 380), (-200, 120, 0)),
    }
    for name, (pos, tgt) in shots.items():
        look_at(cam, pos, tgt)
        sc.render.filepath = os.path.join(PREVIEW_DIR, f"distill_setup_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[preview] {sc.render.filepath}")


main()
