"""Build the ATX mid-tower PC (assembled) and export the GLB + layout.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python build_pc_atx.py [-- --preview] [-- --no-export]

Outputs
- apps/web/public/models/pc_atx.glb       one top-level node per part ID, mesh in part-local mm
- packages/products/blender/pc_atx.layout.json   part positions, coarse boxes, feature positions
- packages/products/blender/previews/*.png       (with --preview) EEVEE renders

Axes are the engine's: +Y up, +X case front, +Z toward the glass side panel, 1 unit = 1 mm.
All parts keep rotation [0, 0, 0]; meshes are modelled in their installed orientation.
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
from lib import (  # noqa: E402
    Part,
    axis_m,
    bundle,
    dimm_module,
    dimm_slot,
    fan,
    fin_stack,
    grid_offsets,
    grille,
    label_text,
    m2_2280,
    m2_socket,
    mat,
    pcie_x16_slot,
    pin_block,
    plug,
    screw,
    slot_grid,
    smd_scatter,
    standoff,
    xf,
)

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GLB_OUT = os.path.join(ROOT, "apps", "web", "public", "models", "pc_atx.glb")
LAYOUT_OUT = os.path.join(HERE, "pc_atx.layout.json")
PREVIEW_DIR = os.path.join(HERE, "previews")
PRODUCT_JSON = os.path.join(ROOT, "packages", "products", "data", "pc_atx.json")

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

PART_IDS = [
    "case", "side_panel", "motherboard", "cpu", "thermal_paste", "cooler", "cooler_fan_cable", "ram",
    "m2_ssd", "m2_heatsink", "psu", "atx_24pin_cable", "eps_8pin_cable", "gpu", "gpu_power_cable",
]  # fmt: skip

# --------------------------------------------------------------------------------------------
# palette: neutral product look so the engine's red/green highlights stay readable

M = dict(
    case=mat("case_white", "#e8eaed", 0.15, 0.42),
    case_in=mat("case_interior", "#dfe2e6", 0.15, 0.5),
    case_dark=mat("case_mesh_dark", "#2b2e33", 0.3, 0.55),
    case_trim=mat("case_trim", "#b9bec5", 0.8, 0.3),
    rubber=mat("rubber", "#1b1c1f", 0.0, 0.85),
    glass=mat("glass", "#a9bccc", 0.0, 0.04, alpha=0.1),
    glass_frit=mat("glass_frit", "#16181b", 0.0, 0.2, alpha=0.92),
    led=mat("led_white", "#f4f7ff", 0.0, 0.3, emission="#dfe8ff", emission_strength=2.0),
    pcb=mat("pcb_black", "#1c1f24", 0.0, 0.55),
    pcb_dark=mat("pcb_darker", "#14161a", 0.0, 0.6),
    silk=mat("silkscreen", "#8d949e", 0.0, 0.6),
    gold=mat("gold", "#d6a842", 1.0, 0.28),
    steel=mat("steel", "#c4c8ce", 1.0, 0.32),
    screw=mat("screw", "#9aa0a8", 1.0, 0.35),
    screw_dark=mat("screw_slot", "#3b3f45", 0.6, 0.5),
    alu=mat("aluminium", "#cfd3d8", 1.0, 0.3),
    alu_dark=mat("aluminium_dark", "#565c64", 0.9, 0.38),
    gunmetal=mat("gunmetal", "#3a3f46", 0.85, 0.38),
    copper=mat("copper", "#c27c4e", 1.0, 0.26),
    nickel=mat("nickel", "#d9dcdf", 1.0, 0.22),
    plastic_black=mat("plastic_black", "#202226", 0.0, 0.5),
    plastic_gray=mat("plastic_gray", "#6b717a", 0.0, 0.5),
    plastic_light=mat("plastic_light", "#a7adb5", 0.0, 0.45),
    plastic_ivory=mat("plastic_ivory", "#e9e4d8", 0.0, 0.5),
    plastic_white=mat("plastic_white", "#f1f2f3", 0.0, 0.45),
    hole=mat("hole_dark", "#0b0c0e", 0.0, 0.8),
    chip=mat("chip_black", "#17181b", 0.0, 0.35),
    smd=mat("smd_tan", "#8b7a62", 0.0, 0.5),
    smd2=mat("smd_gray", "#4c5057", 0.3, 0.45),
    cap=mat("capacitor", "#2b2f35", 0.6, 0.35),
    fan_frame=mat("fan_frame", "#2a2d33", 0.0, 0.5),
    fan_blade=mat("fan_blade", "#40454d", 0.0, 0.45),
    fan_hub=mat("fan_hub", "#2f3339", 0.0, 0.4),
    label=mat("label_light", "#d7dbe0", 0.0, 0.55),
    accent=mat("accent_blue", "#4a7bd0", 0.3, 0.4),
    usb_blue=mat("usb_blue", "#2f5fb3", 0.0, 0.5),
    wire=mat("wire_black", "#17181b", 0.0, 0.6),
    sleeve=mat("cable_sleeve", "#24262a", 0.0, 0.7),
    paste=mat("thermal_paste", "#b9bdc3", 0.2, 0.55),
    ram_spreader=mat("ram_spreader", "#e6e8eb", 0.7, 0.3),
    ram_spreader2=mat("ram_spreader_inset", "#9aa1ab", 0.8, 0.35),
    ram_accent=mat("ram_accent", "#30343a", 0.3, 0.4),
    substrate=mat("cpu_substrate", "#2d3a33", 0.0, 0.5),
    ihs=mat("cpu_ihs", "#d3d6da", 1.0, 0.25),
    psu_body=mat("psu_body", "#1e2024", 0.4, 0.5),
    gpu_shroud=mat("gpu_shroud", "#2c3036", 0.5, 0.42),
    gpu_accent=mat("gpu_accent", "#c9ced5", 1.0, 0.25),
    backplate=mat("gpu_backplate", "#33373e", 0.9, 0.4),
)

# --------------------------------------------------------------------------------------------
# layout (world mm). Part origins; everything else is derived from these.

POS = {
    "case": (0, 0, 0),
    "side_panel": (0, 0, 212),
    "motherboard": (-93, 55, 7),
    "cpu": (-118, 135, 15),
    "thermal_paste": (-118, 135, 18.25),
    "cooler": (-118, 135, 18.5),
    "ram": (-33, 125, 27.625),
    "m2_ssd": (-110, 16.5, 10.4),
    "m2_heatsink": (-110, 16.5, 16.1),
    "psu": (-151, -188, 95),
    "gpu": (-85.5, 35, 67),
}
MB = Vector(POS["motherboard"])
BOARD_TOP = 0.8  # motherboard local z of the PCB top
RAM_NOTCH_Y = -4.3  # DDR4 key: 62.35 mm from the -Y end of a 133.35 mm module


def mbw(x, y, z=BOARD_TOP):
    """Motherboard-local point -> world."""
    return MB + Vector((x, y, z))


def local(part_id, w):
    return Vector(w) - Vector(POS[part_id])


# motherboard-local anchors
SOCKET = (-25.0, 80.0)
DIMM_X = {"dimm_a1": 40.0, "dimm_a2": 50.0, "dimm_b1": 60.0, "dimm_b2": 70.0}
DIMM_Y = 70.0
PCIE_Y = -20.0
PCIE_X = -132.5 - MB.x  # slot centre (world x -132.5)
M2_Y = -38.5
SSD_X = POS["m2_ssd"][0] - MB.x
ATX24 = (114.0, 31.0)
EPS8 = (-88.0, 146.0)
FAN_HDR = (5.0, 146.0)
BOARD_SCREWS = [(-112, 145), (112, -145), (112, 145), (-112, -145), (-112, -10), (112, -10)]


# --------------------------------------------------------------------------------------------
# parts


def build_case():
    p = Part("case")
    W, H, D = 450.0, 470.0, 214.0  # x, y, z (z from -4 to 210)
    zc = D / 2 - 4
    with p.group("#d9dce1"):  # tray / right side
        p.box((W, H, 4), (0, 0, -2), M["case_in"], bevel=1.5)
    with p.group("#d9dce1"):
        p.box((W, 4, D), (0, H / 2 - 2, zc), M["case"], bevel=1.5)  # top
    with p.group("#d9dce1"):
        p.box((W, 4, D), (0, -H / 2 + 2, zc), M["case"], bevel=1.5)  # bottom
    with p.group("#d9dce1"):
        p.box((4, H - 8, D), (-W / 2 + 2, 0, zc), M["case"], bevel=1.0)  # rear wall
    with p.group("#d9dce1"):
        # front: white frame + dark mesh insert
        fx = W / 2 - 5
        p.box((10, H, 14), (fx, 0, D - 4 - 7), M["case"], bevel=3)
        p.box((10, H, 14), (fx, 0, -4 + 7), M["case"], bevel=3)
        p.box((10, 18, D), (fx, H / 2 - 9, zc), M["case"], bevel=3)
        p.box((10, 18, D), (fx, -H / 2 + 9, zc), M["case"], bevel=3)
        p.box((2.0, H - 36, D - 28), (fx + 2.5, 0, zc), M["case_dark"])
        with p.at(xf((fx + 3.6, 0, zc), (0, 90, 0))):
            slot_grid(p, (D - 34, H - 42), 15, 32, (3.4, 3.4, 0.6), M["plastic_gray"])
    # feet
    for x in (-185, 185):
        for z in (14, 192):
            p.box((46, 10, 16), (x, -H / 2 - 5, z), M["rubber"], bevel=3)
    # top: vent mesh, power button with LED ring, two USB ports
    with p.at(xf((-20, H / 2 + 0.05, 105), (-90, 0, 0))):
        p.box((280, 150, 0.4), (0, 0, 0), M["case_dark"])
        slot_grid(p, (270, 140), 24, 12, (6.0, 6.0, 0.5), M["plastic_gray"], pos=(0, 0, 0.1))
    with p.at(xf((190, H / 2, 100), (-90, 0, 0))):
        p.annulus(7.2, 8.2, 1.6, (0, 0, 0.8), M["led"], seg=40)
        p.cyl(7.0, 2.6, (0, 0, 1.3), M["case_trim"], seg=40)
        p.cyl(4.0, 0.3, (0, 0, 2.7), M["screw_dark"], seg=24)
        for i, x in enumerate((-12, 12)):
            p.box((13, 5.5, 0.6), (x * 1.6 + 2, 20, 0.2), M["hole"], bevel=0.8)
            p.box((11, 1.8, 0.7), (x * 1.6 + 2, 20, 0.3), M["usb_blue"])
    p.feature("case_power_button", (190, H / 2 + 1.4, 100))

    # rear wall inner side: I/O shield, fan vents, slot rail and covers
    rx = -W / 2 + 4  # inner face x
    io_lo, io_hi = 75.0, 195.0
    p.box((1.0, io_hi - io_lo, 46), (rx + 0.5, (io_lo + io_hi) / 2, 6 + 23), M["alu_dark"])
    with p.at(xf((rx + 0.6, 160, 120), (0, 90, 0))):
        p.box((118, 118, 0.4), (0, 0, 0), M["case_dark"])
    with p.at(xf((rx, 0, 0))):
        p.box((9, 140, 5), (6.5, -25, 128.5), M["case"], bevel=1.0)  # slot rail (gap for brackets)
        for k in range(7):
            y = PCIE_Y + MB.y - 20.32 * k
            if k < 2:
                continue  # the GPU bracket fills the first two slots
            p.box((1.2, 18.5, 108), (0.6, y, 73), M["case_trim"], bevel=0.5)
            with p.at(xf((1.25, y, 73), (0, 90, 0))):
                slot_grid(p, (90, 9), 9, 1, (7.5, 1.8, 0.3), M["hole"])
            screw(p, (11, y, 131), 3.0, "z", M["screw"], M["screw_dark"])
    p.feature("case_ground", (rx + 0.2, -60, 150))

    # tray: standoffs, grommets, CPU cutout, cable tie points
    for sx, sy in BOARD_SCREWS:
        w = mbw(sx, sy, 0)
        standoff(p, (w.x, w.y, 0), 6.2, M["case_trim"])
    for gx, gy, gw, gh in ((46, 95, 12, 90), (-182, 223, 46, 8), (5, -128, 60, 10)):
        p.box((gw + 6, gh + 6, 1.0), (gx, gy, 0.5), M["rubber"], bevel=2.0, round_axis="z")
        p.box((gw, gh, 1.2), (gx, gy, 0.6), M["hole"], bevel=1.5, round_axis="z")
    # PSU support rails on the bottom
    for z in (30, 160):
        p.box((150, 3, 10), (-150, -H / 2 + 5.5, z), M["rubber"], bevel=1)

    # fans: rear exhaust, three front intakes
    def case_fan(center, axis):
        with p.at(axis_m(axis, center)):
            fan(p, 120, 25, M["fan_frame"], M["fan_blade"], M["fan_hub"], M["hole"])

    with p.group("#24272c"):
        case_fan((rx + 12.5, 160, 120), "-x")
    p.feature("rear_fan_airflow", (rx + 26, 160, 120))
    for y in (130, 5, -120):
        with p.group("#24272c"):
            case_fan((W / 2 - 10 - 15, y, 105), "-x")
    p.feature("front_fan_airflow", (W / 2 - 38.5, 130, 105))
    return p


def build_side_panel():
    p = Part("side_panel")
    W, H, T = 450.0, 470.0, 4.0
    with p.group("#a5b4c3"):
        p.box((W - 2, H - 2, T), (0, 0, 0), M["glass"], bevel=1.2)
    # dark frit border on the inside face
    b = 14.0
    for sx in (-1, 1):
        p.box((b, H - 4, 0.3), (sx * (W / 2 - 1 - b / 2), 0, -T / 2 - 0.15), M["glass_frit"])
    for sy in (-1, 1):
        p.box((W - 2 * b - 4, b, 0.3), (0, sy * (H / 2 - 1 - b / 2), -T / 2 - 0.15), M["glass_frit"])
    for i, sy in enumerate((220, -220), 1):
        x = -215.0
        p.cyl(6.5, 5.0, (x, sy, T / 2 + 2.5), M["case_trim"], seg=36)
        for k in range(12):
            a = 2 * math.pi * k / 12
            p.box((1.0, 1.4, 4.0), (x + 6.6 * math.cos(a), sy + 6.6 * math.sin(a), T / 2 + 2.5), M["case_trim"],
                  rot=(0, 0, math.degrees(a)))  # fmt: skip
        p.cyl(4.5, 0.4, (x, sy, T / 2 + 5.1), M["screw_dark"], seg=24)
        p.feature(f"panel_screw_{i}", (x, sy, T / 2))
    return p


def build_motherboard():
    p = Part("motherboard")
    t = 1.6
    z = BOARD_TOP
    with p.group("#1c1f24"):
        p.box((244, 305, t), (0, 0, 0), M["pcb"], bevel=1.5, round_axis="z")
    # mounting holes with gold rings + screws
    for i, (x, y) in enumerate(BOARD_SCREWS, 1):
        p.annulus(1.8, 4.2, 0.08, (x, y, z + 0.04), M["gold"], seg=24)
        screw(p, (x, y, z), 3.6, "z", M["screw"], M["screw_dark"], h=2.0)
        p.feature(f"board_screw_{i}", (x, y, z))

    # CPU socket (AM4 style PGA), retention brackets, triangle
    sx, sy = SOCKET
    with p.group("#e5e1d8"):
        p.box((42, 42, 4.2), (sx, sy, z + 2.1), M["plastic_ivory"], bevel=0.6)
        p.box((36, 36, 0.3), (sx, sy, z + 4.05), M["plastic_light"])
        slot_grid(p, (34, 34), 11, 11, (1.0, 1.0, 0.2), M["hole"], pos=(sx, sy, z + 4.15))
        # lever along the bottom edge
        p.box((44, 3.0, 2.6), (sx, sy - 23.5, z + 2.4), M["steel"], bevel=0.8)
        p.box((3, 8, 2.6), (sx + 22.5, sy - 20, z + 2.4), M["steel"], bevel=0.8)
    with p.at(xf((sx - 21, sy + 21, z + 0.08))):
        p.cyl(2.2, 0.3, (0, 0, 0), M["gold"], seg=3, spin=135, smooth=False)
    p.feature("cpu_socket", (sx, sy, z + 4.2))
    p.feature("socket_triangle", (sx - 21, sy + 21, z + 0.3))
    for yy in (45, -45):
        p.box((62, 9, 6), (sx, sy + yy, z + 3), M["plastic_black"], bevel=1.5)
        for xx in (-27, 27):
            p.cyl(3.6, 9.5, (sx + xx, sy + yy, z + 4.75), M["plastic_black"], seg=20)
            p.cyl(1.8, 0.3, (sx + xx, sy + yy, z + 9.6), M["hole"], seg=16)
    # solid caps and chokes around the socket
    for i in range(10):
        p.cyl(3.0, 7.0, (sx - 40 + 0, sy - 24 + i * 6.0, z + 3.5), M["cap"], seg=16) if i < 9 else None
    for i in range(8):
        p.box((7.5, 7.5, 5), (sx - 50, sy - 20 + i * 8.5, z + 2.5), M["smd2"], bevel=0.6)
        p.box((7.5, 7.5, 5), (sx - 18 + i * 8.5, sy + 34.5, z + 2.5), M["smd2"], bevel=0.6) if i < 6 else None

    # VRM heatsinks (left and top of the socket)
    with p.group("#4a4f57"):
        with p.at(xf((sx - 63, sy - 4, z))):
            p.box((18, 84, 8), (0, 0, 4), M["gunmetal"], bevel=1.2)
            fin_stack(p, (18, 84, 9), 7, 1.6, M["gunmetal"], axis="x") if False else None
            for k in range(6):
                p.box((1.8, 84, 9), (-7.5 + k * 3.0, 0, 12.5), M["gunmetal"], bevel=0.5)
            p.box((18.4, 84.4, 1.0), (0, 0, 17.4), M["alu_dark"], bevel=0.4)
    with p.group("#4a4f57"):
        with p.at(xf((sx - 22, sy + 52, z))):
            p.box((66, 15, 8), (0, 0, 4), M["gunmetal"], bevel=1.2)
            for k in range(5):
                p.box((66, 1.8, 9), (0, -6 + k * 3.0, 12.5), M["gunmetal"], bevel=0.5)
            p.box((66.4, 15.4, 1.0), (0, 0, 17.4), M["alu_dark"], bevel=0.4)

    # rear I/O shroud and ports
    with p.group("#3a3f46"):
        with p.at(xf((-110, 80, z))):
            p.box((24, 120, 30), (0, 0, 15), M["gunmetal"], bevel=3.0)
            p.box((24.4, 100, 1.2), (0, -2, 22), M["alu"], bevel=0.4)
            p.box((14, 120.4, 1.5), (3, 0, 30.2), M["alu_dark"], bevel=0.5)
    with p.at(xf((-124, 0, z))):
        ports = [(28, 15, 14, "usb"), (48, 15, 14, "usb"), (68, 16, 13, "usb"), (90, 15, 12, "dark"),
                 (110, 16, 14, "usb"), (130, 12, 20, "audio")]  # fmt: skip
        for py, pw, ph, kind in ports:
            p.box((12, pw, ph), (2, py, ph / 2), M["steel"] if kind != "audio" else M["plastic_black"], bevel=0.4)
            if kind == "usb":
                for k in (-1, 1):
                    p.box((0.4, pw - 3, 1.6), (-4.1, py, ph / 2 + k * 3.2), M["usb_blue"])
            elif kind == "audio":
                for k in range(3):
                    p.cyl(1.8, 0.4, (-4.0, py, 4 + k * 5.5), M["gold"], axis="x", seg=16)

    # DIMM slots: A2/B2 (recommended) light, A1/B1 dark
    for fid, x in DIMM_X.items():
        light = fid in ("dimm_a2", "dimm_b2")
        with p.at(xf((x, DIMM_Y, z))):
            dimm_slot(p, 144, M["plastic_light"] if light else M["plastic_black"], M["plastic_white"], M["hole"])
            p.box((1.8, 1.6, 2.0), (0, RAM_NOTCH_Y, 7.0), M["plastic_light"] if light else M["plastic_black"])
            p.coarse((7.0, 144, 7.6), (0, 0, 3.8), "#374151" if not light else "#9aa1aa")
        p.feature(fid, (x, DIMM_Y, z + 7.7))
        if light:
            tag = fid.split("_")[1]
            p.feature(f"dimm_{tag}_latch_top", (x, DIMM_Y + 69, z + 8.4))
            p.feature(f"dimm_{tag}_latch_bottom", (x, DIMM_Y - 69, z + 8.4))

    # power connectors and fan header
    ax, ay = ATX24
    with p.group("#202226"):
        with p.at(xf((ax, ay, z), (0, 0, 90))):
            pin_block(p, 12, 2, 4.2, 8.0, M["plastic_black"], M["hole"])
    p.feature("atx_24pin", (ax, ay, z + 8.0))
    ex, ey = EPS8
    with p.group("#202226"):
        with p.at(xf((ex, ey, z))):
            pin_block(p, 4, 2, 4.2, 8.0, M["plastic_black"], M["hole"])
    p.feature("eps_8pin", (ex, ey, z + 8.0))
    fx, fy = FAN_HDR
    with p.group("#f3f4f6"):
        with p.at(xf((fx, fy, z))):
            p.box((11.2, 3.0, 1.5), (0, 0, 0.75), M["plastic_white"], bevel=0.2)
            p.box((11.2, 0.8, 6.0), (0, 1.9, 3.0), M["plastic_white"], bevel=0.2)
            for k in range(4):
                p.box((0.64, 0.64, 6.0), (-3.81 + k * 2.54, 0, 3.0), M["gold"])
    p.feature("cpu_fan_header", (fx, fy, z + 6.0))

    # PCIe x16 (armoured), x1, second x16 (x4)
    with p.at(xf((PCIE_X, PCIE_Y, z))):
        pcie_x16_slot(p, M["plastic_black"], M["plastic_light"], M["hole"], M["steel"])
        p.coarse((89 + 2 * 3.6 + 7.0, 8.8, 11.2), (3.6, 0, 5.6), "#111827")
    p.feature("pcie_slot", (PCIE_X, PCIE_Y, z + 11.2))
    p.feature("pcie_latch", (PCIE_X + 48.1, PCIE_Y, z + 11.2))
    with p.at(xf((PCIE_X - 32, -80, z))):
        p.box((25, 7.6, 11.2), (0, 0, 5.6), M["plastic_black"], bevel=0.5)
        p.box((21, 1.8, 0.6), (0, 0, 11.25), M["hole"])
    with p.at(xf((PCIE_X, -121, z))):
        pcie_x16_slot(p, M["plastic_black"], M["plastic_light"], M["hole"], M["steel"], armored=False)

    # M.2 socket + standoff, under the GPU
    with p.group("#111827"):
        with p.at(xf((SSD_X - 40 - 2.3, M2_Y, z))):
            m2_socket(p, M["plastic_black"], M["hole"])
    p.feature("m2_slot", (SSD_X - 42.3, M2_Y, z + 4.2))
    sx2 = SSD_X + 38.4
    with p.group("#b08d57"):
        p.cyl(2.6, 2.0, (sx2, M2_Y, z + 1.0), M["gold"], seg=6, smooth=False)
    screw(p, (sx2, M2_Y, z + 2.0 + 0.8), 2.3, "z", M["screw"], M["screw_dark"], h=1.2)
    p.feature("m2_screw_hole", (sx2, M2_Y, z + 2.0))
    p.box((84, 0.4, 0.05), (SSD_X, M2_Y + 12.5, z + 0.03), M["silk"])
    p.box((84, 0.4, 0.05), (SSD_X, M2_Y - 12.5, z + 0.03), M["silk"])

    # chipset heatsink, battery, SATA, front headers, audio shield
    with p.group("#4b5563"):
        with p.at(xf((65, -95, z))):
            p.box((46, 46, 7), (0, 0, 3.5), M["gunmetal"], bevel=2.0)
            p.box((36, 36, 0.8), (0, 0, 7.3), M["alu"], bevel=1.0)
            p.box((26, 1.4, 0.5), (0, 0, 7.9), M["accent"])
    p.cyl(10, 3.2, (32, -70, z + 1.6), M["steel"], seg=40)
    for k in range(4):
        p.box((8, 11, 6), (117, -40 - k * 13, z + 3), M["plastic_black"], bevel=0.5)
        p.box((0.6, 8, 2), (121.3, -40 - k * 13, z + 3.5), M["hole"])
    for k, x in enumerate((-60, -20, 20, 80)):
        with p.at(xf((x, -147, z))):
            p.box((14 if k < 3 else 24, 5.5, 6), (0, 0, 3), M["plastic_black"], bevel=0.3)
            for i in range(5 if k < 3 else 9):
                p.box((0.64, 0.64, 6.5), (-5 + i * 2.54, 0, 3.3), M["gold"])
    p.box((32, 24, 2.0), (-98, -128, z + 1.0), M["steel"], bevel=0.6)
    smd_scatter(p, (-80, 90, -150, -100), z, 60, [M["smd"], M["smd2"], M["chip"]], seed=11)
    smd_scatter(p, (-60, 20, 110, 135), z, 30, [M["smd"], M["smd2"]], seed=12)
    p.box((14, 14, 1.2), (95, 120, z + 0.6), M["chip"], bevel=0.3)
    p.box((10, 10, 1.2), (-60, -70, z + 0.6), M["chip"], bevel=0.3)
    # silkscreen detail lines
    for k in range(6):
        p.box((0.35, 120, 0.04), (90 + k * 4, 30, z + 0.02), M["silk"])
    return p


def build_cpu():
    p = Part("cpu")
    with p.group("#2f6b3b"):
        p.box((40, 40, 1.2), (0, 0, -2.4), M["substrate"], bevel=0.4, round_axis="z")
    p.box((36, 36, 0.4), (0, 0, -3.2), M["gold"])  # pin field (sits in the socket)
    with p.group("#c0c4ca"):
        p.box((36, 36, 1.4), (0, 0, -1.1), M["ihs"], bevel=1.5, round_axis="z")
        p.box((32, 32, 3.6), (0, 0, 1.0), M["ihs"], bevel=1.2)
    with p.at(xf((-18.2, 18.2, -1.78))):
        p.cyl(1.8, 0.1, (0, 0, 0), M["gold"], seg=3, spin=135, smooth=False)
    p.feature("cpu_triangle", (-18.2, 18.2, -1.7))
    p.feature("cpu_ihs", (0, 0, 2.8))
    return p


def build_thermal_paste():
    p = Part("thermal_paste")
    with p.group("#d1d5db"):
        p.box((24, 24, 0.3), (0, 0, -0.1), M["paste"], bevel=3.0, round_axis="z")
        p.cyl(7.0, 0.5, (0, 0, 0.05), M["paste"], seg=32, r2=4.0)
    return p


def build_cooler():
    p = Part("cooler")
    # cold plate + base + mounting bars with spring screws
    with p.group("#b87333"):
        p.box((40, 40, 3), (0, 0, 1.5), M["copper"], bevel=0.6)
        p.box((46, 50, 6), (0, 0, 6), M["nickel"], bevel=1.2)
    for x in (-27, 27):
        with p.group("#6b7280"):
            p.box((9, 104, 3.2), (x, 0, 10.4), M["steel"], bevel=1.0)
            for y in (-45, 45):
                screw(p, (x, y, 12.0), 3.2, "z", M["screw"], M["screw_dark"], h=2.4)
    for i, (x, y) in enumerate(((-27, 45), (27, -45), (27, 45), (-27, -45)), 1):
        p.cyl(1.6, 20.0, (x, y, 2.0), M["steel"], seg=12)
        p.annulus(2.0, 3.2, 8.0, (x, y, 4.5), M["steel"], seg=16)
        p.feature(f"cooler_screw_{i}", (x, y, 12.0))
    # heat pipes: three U pipes, legs through the fin stack
    fin_z0, fin_z1 = 26.5, 146.5
    for x, s in ((-12, 18), (0, 36), (12, 52)):
        lift = 7.0 if s < 24 else 20.0
        inner = min(s, 16.0)
        pts = [(x, -s, fin_z1 + 2), (x, -s, lift), (x, -inner, 7.0), (x, inner, 7.0), (x, s, lift), (x, s, fin_z1 + 2)]
        p.pipe(pts, 3.0, M["copper"], bend=9.0, seg=14)
        for yy in (-s, s):
            p.cyl(3.4, 1.2, (x, yy, fin_z1 + 2.6), M["nickel"], seg=16)
    p.coarse((36, 110, 17.0), (0, 0, 9.5 + 8.5), "#b87333")  # exposed pipes between base and fins
    # fin stack
    with p.group("#d1d5db"):
        with p.at(xf((0, 0, (fin_z0 + fin_z1) / 2))):
            fin_stack(p, (50, 125, fin_z1 - fin_z0), 46, 0.45, M["alu"], axis="z")
            for sx in (-1, 1):  # folded fin edges give a solid look from the sides
                p.box((0.5, 125, fin_z1 - fin_z0), (sx * 25, 0, 0), M["alu"])
        p.box((52, 127, 3), (0, 0, fin_z1 + 1.5), M["gunmetal"], bevel=1.2)
        p.box((30, 70, 0.4), (0, 0, fin_z1 + 3.1), M["alu_dark"], bevel=1.0)
    # 120 mm fan on the front face, blowing to the rear (-x)
    with p.group("#1f2328"):
        with p.at(axis_m("-x", (25 + 12.5, 0, (fin_z0 + fin_z1) / 2))):
            fan(p, 120, 25, M["fan_frame"], M["fan_blade"], M["fan_hub"], M["hole"])
    for zz in (fin_z0 + 8, fin_z1 - 8):  # wire clips
        p.pipe([(52, -62, zz), (26, -63, zz)], 0.8, M["steel"])
        p.pipe([(52, 62, zz), (26, 63, zz)], 0.8, M["steel"])
    p.feature("cooler_airflow", (50.5, 0, (fin_z0 + fin_z1) / 2))
    return p


def build_ram():
    p = Part("ram")
    p.children = []
    mats = dict(pcb=M["pcb"], chip=M["chip"], gold=M["gold"], spreader=M["ram_spreader"],
                spreader2=M["ram_spreader2"], accent=M["ram_accent"])  # fmt: skip
    for i, (x, slot) in enumerate(((-10, "a2"), (10, "b2")), 1):
        c = Part(f"ram_{slot}")
        with c.group("#e6e8eb"):
            with c.at(xf((x, 0, 0))):
                dimm_module(c, 133.35, 31.25, 133.35 / 2 + RAM_NOTCH_Y, mats)
        p.boxes += c.boxes
        p.children.append(c)
        p.feature(f"ram_notch_{i}", (x, RAM_NOTCH_Y, -15.625))
    return p


def build_m2_ssd():
    p = Part("m2_ssd")
    mats = dict(pcb=M["pcb_dark"], gold=M["gold"], chip=M["chip"], label=M["label"], accent=M["accent"],
                smd=M["smd"], smd2=M["smd2"])  # fmt: skip
    p.coarse((80, 22, 0.8), (0, 0, 0), "#1e293b")
    p.coarse((60, 18, 1.3), (6, 0, 0.4 + 0.65), "#111827")
    m2_2280(p, mats)
    p.feature("m2_notch", (-40, 22 / 2 - 6.6, 0))
    return p


def build_m2_heatsink():
    p = Part("m2_heatsink")
    with p.group("#8a8f98"):
        p.box((76, 19, 1.0), (0, 0, -3.5), M["plastic_light"])  # thermal pad
        p.box((76.4, 19.4, 0.12), (0, 0, -4.06), M["accent"])  # protective film
        p.box((86, 25, 4), (0, 0, -1), M["gunmetal"], bevel=1.2)
        for k in range(5):
            p.box((80, 2.6, 2.0), (0, -8 + k * 4, 1.8), M["gunmetal"], bevel=0.6)
        p.box((30, 25.2, 0.6), (-18, 0, 2.6), M["alu"], bevel=0.3)
    p.feature("m2_pad_film", (0, 0, -4.1))
    for i, x in enumerate((-40, 40), 1):
        screw(p, (x, 0, 1.0), 2.6, "z", M["screw"], M["screw_dark"], h=1.6)
        p.feature(f"heatsink_screw_{i}", (x, 0, 2.6))
    return p


def build_psu():
    p = Part("psu")
    X, Y, Z = 140.0, 86.0, 150.0
    with p.group("#27272a"):
        p.box((X, Y, Z), (0, 0, 0), M["psu_body"], bevel=2.5)
    # top fan with wire guard
    with p.at(axis_m("y", (0, Y / 2, 0))):
        p.annulus(58, 61, 1.0, (0, 0, 0.3), M["hole"], seg=64)
        p.cyl(58, 0.4, (0, 0, -0.5), M["hole"], seg=64)
    with p.at(axis_m("-y", (0, Y / 2 - 4, 0))):
        p.blade_fan(20, 56, 8, 9, M["fan_blade"])
        p.cyl(20, 6, (0, 0, 0), M["fan_hub"], seg=40)
    grille(p, 58, 5, 1.1, M["gunmetal"], axis="y", spokes=4, pos=(0, Y / 2 + 0.8, 0))
    # side label (faces the glass)
    with p.at(xf((0, 0, Z / 2 + 0.05))):
        p.box((96, 54, 0.3), (0, -4, 0), M["label"], bevel=1.5, round_axis="z")
        label_text(p, "750W", 14, (0, 4, 0.25), M["plastic_black"], depth=0.3)
        label_text(p, "80+ GOLD  ATX 3.0", 5, (0, -14, 0.25), M["plastic_gray"], depth=0.25)
    # rear face: honeycomb-ish vents, AC inlet, rocker switch
    with p.at(xf((-X / 2 - 0.05, 0, 0), (0, -90, 0))):
        slot_grid(p, (80, 60), 14, 9, (3.6, 3.6, 0.4), M["hole"], pos=(-25, 0, 0))
        p.box((30, 24, 1.0), (40, -8, 0.3), M["plastic_black"], bevel=2.0)
        p.box((24, 16, 1.2), (40, -8, 0.6), M["hole"], bevel=2.5)
        p.box((10, 14, 3.0), (45, 28, 1.0), M["plastic_black"], bevel=1.0)
        p.box((8, 6, 1.6), (45, 31, 2.6), M["plastic_gray"], bevel=0.6, rot=(12, 0, 0))
    p.feature("psu_switch", (-X / 2 - 1, 28, 45))
    # front face: modular sockets
    with p.at(xf((X / 2 + 0.05, 0, 0), (0, 90, 0))):
        p.box((130, 60, 0.4), (0, 0, 0), M["plastic_black"], bevel=2)
        for i, (cx, cy, cols, rows) in enumerate(((-45, 15, 6, 2), (-15, 15, 4, 2), (5, 15, 4, 2), (25, 15, 4, 2),
                                                   (45, 15, 4, 2), (-45, -12, 9, 2), (-5, -12, 3, 2), (20, -12, 3, 2))):  # fmt: skip
            with p.at(xf((cx, cy, 0.2))):
                p.box((cols * 4.2 + 2, rows * 4.2 + 2, 0.8), (0, 0, 0.2), M["plastic_gray"], bevel=0.4)
                slot_grid(p, (cols * 4.2, rows * 4.2), cols, rows, (3.0, 3.0, 0.4), M["hole"], pos=(0, 0, 0.5))
    for x in (-55, 55):
        for y in (-30, 30):
            screw(p, (-X / 2, y, x), 2.8, "-x", M["screw"], M["screw_dark"], h=1.2)
    return p


def cable_boxes(p, pts, half, color):
    """Coarse boxes for a cable: one inflated AABB per straight segment."""
    for a, b in zip(pts, pts[1:]):
        lo = [min(a[i], b[i]) - half for i in range(3)]
        hi = [max(a[i], b[i]) + half for i in range(3)]
        p.boxes.append({"size": [round(hi[i] - lo[i], 2) for i in range(3)],
                        "position": [round((hi[i] + lo[i]) / 2, 2) for i in range(3)], "color": color})  # fmt: skip


def build_cable(name, cols, rows, pitch, path, plug_rot, wire_m, bend, wire_r=1.45, depth=14.0, latch=True):
    """A plug (mating face at the origin, inserting along -z) and its wire bundle along `path` (local)."""
    p = Part(name)
    with p.group("#111827"):
        with p.at(xf((0, 0, 0), plug_rot)):
            plug(p, cols, rows, pitch, depth, M["plastic_black"], wire_m, wire_len=2.0, latch=latch)
    offs = grid_offsets(cols, rows, pitch)
    if plug_rot != (0, 0, 0):
        R = xf((0, 0, 0), plug_rot).to_3x3()
        offs3 = [R @ Vector((u, v, 0)) for u, v in offs]
    else:
        offs3 = [Vector((u, v, 0)) for u, v in offs]
    start = Vector((0, 0, depth + 1.5))
    # bundle offsets are applied in the transported frame; derive (u, v) from the first segment frame
    pts0 = [Vector(q) for q in path]
    t0 = (pts0[1] - pts0[0]).normalized()
    ref = Vector((0, 1, 0)) if abs(t0.y) < 0.9 else Vector((1, 0, 0))
    n0 = t0.cross(ref).normalized()
    b0 = t0.cross(n0)
    uv = [(o.dot(n0), o.dot(b0)) for o in offs3]
    route = [start] + pts0[1:] if (pts0[0] - start).length < 1e-3 else [start] + pts0
    for wire in bundle(route, uv, bend):
        p.pipe(wire, wire_r, wire_m, seg=8)
    wire_boxes(p, bundle(route, uv, 0.0), wire_r, "#1f2937")
    return p


def wire_boxes(p, raw_wires, r, color):
    """One AABB per straight run, from the unfilleted wire paths (+ wire radius)."""
    for k in range(len(raw_wires[0]) - 1):
        pts = [w[k] for w in raw_wires] + [w[k + 1] for w in raw_wires]
        lo = [min(q[i] for q in pts) - r for i in range(3)]
        hi = [max(q[i] for q in pts) + r for i in range(3)]
        p.boxes.append({"size": [round(hi[i] - lo[i], 2) for i in range(3)],
                        "position": [round((hi[i] + lo[i]) / 2, 2) for i in range(3)], "color": color})  # fmt: skip


def build_atx_24pin_cable():
    w0 = mbw(*ATX24, BOARD_TOP + 8.0)
    gx = 46.0 - w0.x  # grommet x (local)
    path = [(0, 0, 15.5), (0, 0, 26), (gx, 0, 26), (gx, 0, 1.0 + 1.45 - w0.z)]
    return build_cable("atx_24pin_cable", 2, 12, 4.2, path, (0, 0, 0), M["sleeve"], bend=10.0), w0


def build_eps_8pin_cable():
    w0 = mbw(*EPS8, BOARD_TOP + 8.0)
    gy = 223.0 - w0.y
    path = [(0, 0, 15.5), (0, 0, 24), (0, gy, 24), (0, gy, 1.0 + 1.45 - w0.z)]
    return build_cable("eps_8pin_cable", 4, 2, 4.2, path, (0, 0, 0), M["sleeve"], bend=8.0), w0


def build_gpu():
    p = Part("gpu")
    L, Hh = 267.0, 111.0
    zb = -Hh / 2
    # PCB (main + finger tab)
    with p.group("#14532d"):
        p.box((L, 1.6, Hh - 8.5), (0, 0, 4.25), M["pcb"])
    if True:
        fx0, fx1 = PCIE_X + MB.x - POS["gpu"][0] - 44.5, PCIE_X + MB.x - POS["gpu"][0] + 44.5
        p.box((fx1 - fx0, 1.6, 8.5), ((fx0 + fx1) / 2, 0, zb + 4.25), M["pcb"])
        for k in range(int((fx1 - fx0) / 1.0)):
            x = fx0 + 0.5 + k * 1.0
            if abs(x - (fx0 + 11.65)) < 1.0:
                continue
            for sy in (-1, 1):
                p.box((0.7, 0.06, 6.5), (x, sy * 0.83, zb + 3.6), M["gold"])
    # backplate (+y)
    with p.group("#374151"):
        p.box((L - 4, 2.0, Hh - 10), (1, 1.8, 4), M["backplate"], bevel=0.8)
        with p.at(xf((60, 2.85, 10), (-90, 0, 0))):
            slot_grid(p, (100, 40), 10, 3, (6, 1.6, 0.2), M["hole"])
        p.box((150, 0.2, 2), (-30, 2.85, 46), M["gpu_accent"])
    # shroud (-y) with two fans
    shy0, shy1 = -2.0, -30.0
    sz0, sz1 = -45.0, 49.0
    zc = (sz0 + sz1) / 2
    with p.group("#2b2b2b"):
        # heatsink fins visible through the fan openings
        with p.at(xf((0, -15, zc))):
            fin_stack(p, (250, 22, sz1 - sz0 - 3), 80, 0.5, M["alu"], axis="x")
        # end caps and side walls
        p.box((8, shy0 - shy1, sz1 - sz0), (-L / 2 + 6, (shy0 + shy1) / 2, zc), M["gpu_shroud"], bevel=2.0)
        p.box((8, shy0 - shy1, sz1 - sz0), (L / 2 - 4, (shy0 + shy1) / 2, zc), M["gpu_shroud"], bevel=2.0)
        p.box((L - 4, shy0 - shy1, 4), (1, (shy0 + shy1) / 2, sz0 + 2), M["gpu_shroud"], bevel=1.5)
        # top edge (faces the glass): two rails and end blocks, fins show in between
        for yy in (shy0 - 2.5, shy1 + 2.5):
            p.box((L - 4, 5, 4), (1, yy, sz1 - 2), M["gpu_shroud"], bevel=1.5)
        for xx, w in ((-L / 2 + 22, 40), (L / 2 - 30, 52)):
            p.box((w, shy0 - shy1, 4), (xx, (shy0 + shy1) / 2, sz1 - 2), M["gpu_shroud"], bevel=1.5)
        p.box((L - 100, 1.0, 0.6), (-6, shy1 + 0.6, sz1 + 0.1), M["gpu_accent"])
        with p.at(xf((-L / 2 + 22, (shy0 + shy1) / 2, sz1 + 0.05))):
            label_text(p, "GPU", 9, (0, 0, 0.1), M["gpu_accent"], depth=0.25, rot=(0, 0, 0))
        # bottom plate with round openings
        fan_x = (-62.0, 62.0)
        with p.at(xf((0, shy1 + 1.5, zc), (90, 0, 0))):
            for fx in fan_x:
                p.square_ring(47, 45, 3.0, (fx, 0, 0), M["gpu_shroud"], seg=64)
            p.box((26, sz1 - sz0, 3.0), (0, 0, 0), M["gpu_shroud"])
            p.box((L - 4 - 2 * (62 + 47), sz1 - sz0, 3.0), (-(62 + 47) - (L / 2 - 2 - 109) / 2 + 0, 0, 0),
                  M["gpu_shroud"]) if False else None  # fmt: skip
            for sx in (-1, 1):
                w = L / 2 - 2 - 109
                p.box((w, sz1 - sz0, 3.0), (sx * (109 + w / 2), 0, 0), M["gpu_shroud"], bevel=0.8)
            # accent lines
            p.box((L - 20, 1.2, 0.4), (0, (sz1 - sz0) / 2 - 3, -1.7), M["gpu_accent"])
            p.box((L - 20, 1.2, 0.4), (0, -(sz1 - sz0) / 2 + 3, -1.7), M["gpu_accent"])
        for fx in fan_x:
            with p.at(axis_m("y", (fx, shy1 + 7, zc))):
                p.blade_fan(15, 43.5, 7, 11, M["fan_blade"], pitch=28, sweep=36)
                p.cyl(15.5, 7, (0, 0, 0), M["fan_hub"], seg=40)
                p.cyl(12, 0.3, (0, 0, -3.6), M["gpu_accent"], seg=40)
    # bracket (two slots) with tab resting on the case slot rail
    bx = -221.0 + 0.5 - POS["gpu"][0]
    by = (35 - 10.16 - 20.32 / 2 + 10.16) - POS["gpu"][1]  # covers expansion slots 0 and 1
    by = 24.84 - POS["gpu"][1]
    with p.group("#9ca3af"):
        p.box((1.0, 40.6, 120), (bx, by, 3), M["steel"], bevel=0.3)
        p.box((11, 40.6, 1.2), (bx + 5, by, 64.6), M["steel"], bevel=0.3)
        with p.at(xf((bx + 0.55, by, -10), (0, 90, 0))):
            slot_grid(p, (60, 30), 6, 3, (7, 3.5, 0.3), M["hole"])
        p.box((L / 2 + bx + 10, 1.2, 10), ((bx - L / 2) / 2 + 2, -2, 40), M["steel"]) if False else None
    for i, yy in enumerate((0.0, -20.32), 1):
        screw(p, (bx + 6, yy, 65.2), 3.0, "z", M["screw"], M["screw_dark"])
        p.feature(f"gpu_bracket_screw_{i}", (bx + 6, yy, 65.2))
    # 8-pin power on the top edge
    with p.group("#111111"):
        with p.at(xf((96.5, -4.4, Hh / 2 - 6))):
            pin_block(p, 4, 2, 4.2, 9.0, M["plastic_black"], M["hole"], latch=False)
    p.feature("gpu_power", (96.5, -4.4, Hh / 2 + 3.0))
    return p


def build_gpu_power_cable(gpu_world_conn):
    w0 = gpu_world_conn
    path = [(0, 0, 15.5), (0, 0, 22), (0, -150 - w0.y + 0, 22), (0, -150 - w0.y, 22)]
    # down along the front of the GPU, then to the PSU's modular socket
    psu = Vector(POS["psu"])
    tx = psu.x + 70 + 1.45 + 0.1 - w0.x
    path = [(0, 0, 15.5), (0, 0, 26), (0, -158 - w0.y + 0, 26), (tx, -158 - w0.y, 26)]
    return build_cable("gpu_power_cable", 4, 2, 4.2, path, (0, 0, 0), M["sleeve"], bend=12.0)


def build_cooler_fan_cable():
    w0 = mbw(*FAN_HDR, BOARD_TOP + 6.0)
    p = Part("cooler_fan_cable")
    with p.group("#111111"):
        p.box((10.6, 5.2, 7.0), (0, 0, 3.5), M["plastic_black"], bevel=0.5)
        p.box((3.0, 1.2, 5.0), (0, -3.2, 3.5), M["plastic_black"], bevel=0.3)
    # to the cooler fan frame (bottom edge near the hub side)
    cool = Vector(POS["cooler"])
    tgt = Vector((cool.x + 37.5, cool.y + 60 + 0.85, cool.z + 34)) - w0
    path = [(0, 0, 7.5), (0, 0, 14), (0, 0, 14), (tgt.x * 0.4, 0.0, 16), (tgt.x, tgt.y, tgt.z)]
    path = [(0, 0, 7.5), (0, 0, tgt.z), (tgt.x, 0.0, tgt.z), (tgt.x, tgt.y, tgt.z)]
    offs = [(0, -2.54), (0, 0), (0, 2.54)]
    for wire in bundle(path, offs, bend=5.0):
        p.pipe(wire, 0.75, M["wire"], seg=6)
    wire_boxes(p, bundle(path, offs, 0.0)[:], 0.75, "#222222")
    return p, w0


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
    parts = {}
    world = dict(POS)
    builders = [
        ("case", build_case), ("side_panel", build_side_panel), ("motherboard", build_motherboard),
        ("cpu", build_cpu), ("thermal_paste", build_thermal_paste), ("cooler", build_cooler),
        ("ram", build_ram), ("m2_ssd", build_m2_ssd), ("m2_heatsink", build_m2_heatsink),
        ("psu", build_psu), ("gpu", build_gpu),
    ]  # fmt: skip
    for pid, fn in builders:
        parts[pid] = fn()
    p, w0 = build_atx_24pin_cable()
    parts["atx_24pin_cable"], world["atx_24pin_cable"] = p, tuple(w0)
    p, w0 = build_eps_8pin_cable()
    parts["eps_8pin_cable"], world["eps_8pin_cable"] = p, tuple(w0)
    g = parts["gpu"].features["gpu_power"]
    gw = Vector(POS["gpu"]) + Vector(g)
    parts["gpu_power_cable"] = build_gpu_power_cable(gw)
    world["gpu_power_cable"] = tuple(gw)
    p, w0 = build_cooler_fan_cable()
    parts["cooler_fan_cable"], world["cooler_fan_cable"] = p, tuple(w0)
    world = {k: tuple(round(float(c), 3) for c in v) for k, v in world.items()}
    return parts, world


def main():
    reset_scene()
    coll = bpy.data.collections.new("pc_atx")
    bpy.context.scene.collection.children.link(coll)
    parts, world = build_all()
    objs = {}
    for pid in PART_IDS:
        part = parts[pid]
        kids = getattr(part, "children", None)
        if kids:
            part.bm.free()
            ob = bpy.data.objects.new(pid, None)
            ob.empty_display_size = 10
            ob.location = world[pid]
            coll.objects.link(ob)
            for c in kids:
                co = c.finish(coll)
                co.parent = ob
                co["_mesh_child"] = True
        else:
            ob = part.finish(coll, world[pid])
        objs[pid] = ob
        for fid, pos in part.features.items():
            e = bpy.data.objects.new(fid, None)
            e.empty_display_type = "SPHERE"
            e.empty_display_size = 2.0
            e.parent = ob
            e.location = pos
            coll.objects.link(e)

    # layout json --------------------------------------------------------------------------
    layout = {"units": "mm", "source": "packages/products/blender/build_pc_atx.py", "parts": {}, "features": {}}
    for pid in PART_IDS:
        ob, part = objs[pid], parts[pid]
        meshes = [ob] if ob.type == "MESH" else [c for c in ob.children if c.type == "MESH"]
        vs = [v.co for m in meshes for v in m.data.vertices]
        lo = [min(v[i] for v in vs) for i in range(3)]
        hi = [max(v[i] for v in vs) for i in range(3)]
        layout["parts"][pid] = {
            "position": [round(float(c), 3) for c in world[pid]],
            "rotation": [0, 0, 0],
            "bounds": {"size": [round(hi[i] - lo[i], 2) for i in range(3)],
                       "center": [round((hi[i] + lo[i]) / 2, 2) for i in range(3)]},  # fmt: skip
            "boxes": part.boxes,
            "triangles": sum(len(pl.vertices) - 2 for m in meshes for pl in m.data.polygons),
        }
        for fid, pos in part.features.items():
            layout["features"][fid] = {"partId": pid, "position": [round(float(c), 3) for c in pos]}
    with open(LAYOUT_OUT, "w") as f:
        json.dump(layout, f, indent=1, ensure_ascii=False)

    # check against the product data's feature list
    try:
        prod = json.load(open(PRODUCT_JSON))
        want = {f["id"] for f in prod.get("features", [])}
        have = set(layout["features"])
        print("[layout] features missing vs pc_atx.json:", sorted(want - have) or "none")
        print("[layout] extra features:", sorted(have - want) or "none")
    except FileNotFoundError:
        pass

    check_layout(layout)
    if "--no-export" not in ARGS:
        export_glb(objs)
    if "--preview" in ARGS:
        render_previews(objs)


ALLOWED = {("motherboard", "ram"): 4.0}
TOL = 0.5


def check_layout(layout):
    """Python port of the geometry rules in packages/products/src/pc_atx.test.ts."""
    boxes = []
    for pid, pd in layout["parts"].items():
        for b in pd["boxes"]:
            c = [pd["position"][i] + b["position"][i] for i in range(3)]
            boxes.append((pid, [c[i] - b["size"][i] / 2 for i in range(3)], [c[i] + b["size"][i] / 2 for i in range(3)]))

    def ov(a, b):
        return [min(a[2][i], b[2][i]) - max(a[1][i], b[1][i]) for i in range(3)]

    bad, deepest = [], {}
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            if a[0] == b[0]:
                continue
            o = ov(a, b)
            if not all(v > TOL for v in o):
                continue
            key = tuple(sorted((a[0], b[0])))
            d = min(o)
            deepest[key] = max(deepest.get(key, 0), d)
            if key not in ALLOWED or d > ALLOWED[key] + 1e-9:
                bad.append(f"{key[0]}+{key[1]} {d:.2f} [{', '.join(f'{v:.1f}' for v in o)}] {a[1]}..{a[2]} vs {b[1]}..{b[2]}")
    for k in ALLOWED:
        if deepest.get(k, 0) <= TOL:
            bad.append(f"allowed overlap {k} not present (depth {deepest.get(k, 0):.2f})")
    floating = [pid for pid in layout["parts"] if not any(
        all(v >= -TOL for v in ov(a, b)) for a in boxes if a[0] == pid for b in boxes if b[0] != pid)]
    far = []
    for fid, f in layout["features"].items():
        pd = layout["parts"][f["partId"]]
        w = [pd["position"][i] + f["position"][i] for i in range(3)]
        d = min(math.hypot(*[max(b[1][i] - w[i], 0, w[i] - b[2][i]) for i in range(3)]) for b in boxes if b[0] == f["partId"])
        if d > 1.5:
            far.append(f"{fid} {d:.1f}")
    glass = next(b for b in boxes if b[0] == "side_panel")
    inside = max(b[2][2] for b in boxes if b[0] not in ("side_panel", "case"))
    sizes = []
    P = layout["parts"]
    if P["motherboard"]["boxes"][0]["size"][:2] != [244, 305]:
        sizes.append(f"motherboard first box {P['motherboard']['boxes'][0]['size']}")
    if P["ram"]["boxes"][0]["size"][1] != 133.35:
        sizes.append(f"ram first box {P['ram']['boxes'][0]['size']}")
    if P["m2_ssd"]["boxes"][0]["size"][:2] != [80, 22]:
        sizes.append(f"m2_ssd first box {P['m2_ssd']['boxes'][0]['size']}")
    print("[check] overlaps:", bad or "ok")
    for x in bad:
        print("   ", x)
    print("[check] floating:", floating or "ok")
    print("[check] far features:", far or "ok")
    print("[check] glass clear:", "ok" if inside < glass[1][2] else f"inside max z {inside} >= glass {glass[1][2]}")
    print("[check] sizes:", sizes or "ok")
    layout_ok = not (bad or floating or far or sizes or inside >= glass[1][2])
    print("[check] ALL OK" if layout_ok else "[check] FAILED")


def export_glb(objs):
    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob.type == "MESH" or ob.name in PART_IDS)
    bpy.context.view_layer.objects.active = objs["case"]
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
    verify_glb(GLB_OUT)


def verify_glb(path):
    import struct

    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 12)[0]
    gj = json.loads(data[20 : 20 + n])
    names = {nd.get("name") for nd in gj.get("nodes", [])}
    missing = [pid for pid in PART_IDS if pid not in names]
    print(f"[glb] nodes={len(gj.get('nodes', []))} meshes={len(gj.get('meshes', []))} "
          f"materials={len(gj.get('materials', []))}")  # fmt: skip
    for nd in gj["nodes"]:
        if nd.get("name") in PART_IDS and "mesh" not in nd:
            kids = [gj["nodes"][k]["name"] for k in nd.get("children", [])]
            print(f"   {nd['name']:<18} t={[round(v, 1) for v in nd.get('translation', [0, 0, 0])]} children={kids}")
        elif nd.get("name") in PART_IDS:
            acc = gj["accessors"][gj["meshes"][nd["mesh"]]["primitives"][0]["attributes"]["POSITION"]]
            print(f"   {nd['name']:<18} t={[round(v, 1) for v in nd.get('translation', [0, 0, 0])]} "
                  f"min={[round(v, 1) for v in acc['min']]} max={[round(v, 1) for v in acc['max']]}")  # fmt: skip
    print("[glb] all 15 part nodes present" if not missing else f"[glb] MISSING nodes: {missing}")


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
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 48
    except AttributeError:
        pass
    world = bpy.data.worlds.get("preview") or bpy.data.worlds.new("preview")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.78, 0.8, 0.83, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = world
    try:
        sc.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    # lights
    for name, loc, energy, size in (("key", (700, 900, 900), 9.0e6, 600), ("fill", (-600, 300, 700), 3.5e6, 800),
                                     ("rim", (100, 800, -600), 2.5e6, 500)):  # fmt: skip
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        lo = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lo)
        look_at(lo, loc, (0, 0, 90))
    cd = bpy.data.cameras.new("cam")
    cd.lens = 50
    cd.clip_start = 10
    cd.clip_end = 10000
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    shots = {
        "full_34": ((780, 520, 1250), (-10, 0, 100)),
        "front_34": ((-420, 330, 1100), (-30, 20, 90)),
        "board_close": ((150, 330, 560), (-90, 60, 40)),
        "gpu_m2_close": ((180, -260, 420), (-100, 10, 40)),
    }
    for name, (pos, tgt) in shots.items():
        objs["side_panel"].hide_render = name != "full_34"
        look_at(cam, pos, tgt)
        sc.render.filepath = os.path.join(PREVIEW_DIR, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[preview] {sc.render.filepath}")
    objs["side_panel"].hide_render = False
    # exploded-ish: parts lifted along +z by build order
    order = ["case", "motherboard", "cpu", "thermal_paste", "cooler", "cooler_fan_cable", "ram", "m2_ssd",
             "m2_heatsink", "psu", "atx_24pin_cable", "eps_8pin_cable", "gpu", "gpu_power_cable", "side_panel"]  # fmt: skip
    base = {k: objs[k].location.copy() for k in order}
    for i, k in enumerate(order):
        objs[k].location = base[k] + Vector((0, 0, i * 28))
    look_at(cam, (900, 600, 1500), (-20, 0, 250))
    sc.render.filepath = os.path.join(PREVIEW_DIR, "exploded.png")
    bpy.ops.render.render(write_still=True)
    for k in order:
        objs[k].location = base[k]


main()
