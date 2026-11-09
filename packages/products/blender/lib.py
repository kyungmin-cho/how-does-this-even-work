"""Reusable PC-part shape library for Blender (bpy + bmesh, no ops, no textures).

Conventions (match the web engine):
- 1 Blender unit = 1 mm.
- Engine axes are used directly in Blender: +Y is up, +X is the case front, +Z faces the side panel.
  Export with export_yup=False so the GLB keeps these axes as-is.
- Every part is built into one `Part` (a single bmesh with several material slots). Composite
  helpers draw in a canonical frame; wrap them in `with p.at(xf(...)):` to place them.
"""

from __future__ import annotations

import math
import random
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# --------------------------------------------------------------------------------------------
# transforms


def xf(pos=(0, 0, 0), rot=(0, 0, 0), scale=None) -> Matrix:
    """Translation @ rotation (XYZ euler, degrees) @ optional scale."""
    m = Matrix.Translation(Vector(pos)) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
    if scale is not None:
        s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
        m = m @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    return m


# Rotations that turn the canonical +Z axis into the named axis.
AXIS_ROT = {
    "z": (0, 0, 0),
    "-z": (180, 0, 0),
    "x": (0, 90, 0),
    "-x": (0, -90, 0),
    "y": (-90, 0, 0),
    "-y": (90, 0, 0),
}


def axis_m(axis: str, pos=(0, 0, 0), spin: float = 0.0) -> Matrix:
    """Frame whose +Z points along `axis`, optionally spun about that axis (degrees)."""
    return xf(pos, AXIS_ROT[axis]) @ xf((0, 0, 0), (0, 0, spin))


# --------------------------------------------------------------------------------------------
# materials

_MATS: dict[str, bpy.types.Material] = {}


def mat(name: str, color, metallic=0.0, roughness=0.5, alpha=1.0, emission=None, emission_strength=1.0):
    """Principled PBR material (cached by name). color: '#rrggbb' or (r, g, b) in sRGB."""
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    rgb = _rgb(color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*_rgb(emission), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except (AttributeError, TypeError):
                pass
    m.diffuse_color = (*rgb, alpha)
    _MATS[name] = m
    return m


def _rgb(c):
    if isinstance(c, str):
        c = c.lstrip("#")
        c = tuple(int(c[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return tuple(_srgb_to_linear(v) for v in c[:3])


def _srgb_to_linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


# --------------------------------------------------------------------------------------------
# Part: one bmesh, many materials


class Part:
    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.mats: list[bpy.types.Material] = []
        self._stack: list[Matrix] = [Matrix.Identity(4)]
        self.boxes: list[dict] = []  # coarse AABBs (local) for fallback/overlap tests
        self.features: dict[str, tuple] = {}  # feature id -> local position
        self._groups: list[dict] = []

    @contextmanager
    def group(self, color="#555555"):
        """Everything added inside becomes one coarse AABB (part-local) in self.boxes."""
        g = {"min": [1e9] * 3, "max": [-1e9] * 3, "color": color}
        self._groups.append(g)
        try:
            yield self
        finally:
            self._groups.remove(g)
            if g["min"][0] < 1e8:
                self.boxes.append(
                    {
                        "size": [round(g["max"][i] - g["min"][i], 2) for i in range(3)],
                        "position": [round((g["max"][i] + g["min"][i]) / 2, 2) for i in range(3)],
                        "color": color,
                    }
                )

    # transform stack ------------------------------------------------------------------
    @property
    def M(self) -> Matrix:
        return self._stack[-1]

    @contextmanager
    def at(self, m: Matrix):
        self._stack.append(self.M @ m)
        try:
            yield self
        finally:
            self._stack.pop()

    def point(self, p) -> tuple:
        v = self.M @ Vector(p)
        return (round(v.x, 3), round(v.y, 3), round(v.z, 3))

    def feature(self, fid: str, p):
        """Record a feature point (in the current frame) as a part-local position."""
        self.features[fid] = self.point(p)

    def coarse(self, size, pos, color="#555555"):
        """Record a coarse AABB in part-local space (current frame must be axis-aligned)."""
        c = self.M @ Vector(pos)
        r = self.M.to_3x3()
        s = Vector([abs(sum(abs(r[i][j]) * size[j] for j in range(3))) for i in range(3)])
        self.boxes.append(
            {
                "size": [round(s.x, 2), round(s.y, 2), round(s.z, 2)],
                "position": [round(c.x, 2), round(c.y, 2), round(c.z, 2)],
                "color": color,
            }
        )

    def mi(self, m) -> int:
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    # merge ----------------------------------------------------------------------------
    def add(self, src: bmesh.types.BMesh, m, local: Matrix | None = None, smooth=None):
        """Copy `src` into the part with the current transform (and `local`), material `m`."""
        T = self.M @ (local or Matrix.Identity(4))
        idx = self.mi(m)
        vmap = {}
        for v in src.verts:
            co = T @ v.co
            vmap[v] = self.bm.verts.new(co)
            for g in self._groups:
                for i in range(3):
                    if co[i] < g["min"][i]:
                        g["min"][i] = co[i]
                    if co[i] > g["max"][i]:
                        g["max"][i] = co[i]
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = idx
            nf.smooth = f.smooth if smooth is None else smooth
        # carry sharp edges
        for e in src.edges:
            if not e.smooth:
                a, b = vmap[e.verts[0]], vmap[e.verts[1]]
                ne = self.bm.edges.get((a, b))
                if ne:
                    ne.smooth = False
        src.free()

    # primitives -----------------------------------------------------------------------
    def box(self, size, pos=(0, 0, 0), m=None, bevel=0.0, seg=2, rot=(0, 0, 0), round_axis=None):
        """Box centred at pos. bevel rounds edges; round_axis ('x'|'y'|'z') rounds only edges along it."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        if bevel > 0:
            lim = min(s for s in size if s > 0) * 0.49
            if round_axis:
                k = "xyz".index(round_axis)
                edges = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co)[k]) > 1e-6]
                lim = min(size[i] for i in range(3) if i != k) * 0.49
            else:
                edges = list(bm.edges)
            bmesh.ops.bevel(
                bm, geom=edges, offset=min(bevel, lim), segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True
            )
        self.add(bm, m, xf(pos, rot), smooth=False)

    def cyl(self, r, depth, pos=(0, 0, 0), m=None, axis="z", seg=24, r2=None, spin=0.0, smooth=True):
        """Cylinder (or cone if r2) centred at pos along axis."""
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth
        )
        _smooth_sides(bm, smooth)
        self.add(bm, m, axis_m(axis, pos, spin))

    def annulus(self, r_in, r_out, depth, pos=(0, 0, 0), m=None, axis="z", seg=32):
        """Hollow cylinder (ring / tube section)."""
        bm = bmesh.new()
        rings = []
        for z in (-depth / 2, depth / 2):
            for r in (r_in, r_out):
                rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in _angles(seg)])
        bi, bo, ti, to = rings
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((to[i], to[j], ti[j], ti[i]))  # top
            bm.faces.new((bi[i], bi[j], bo[j], bo[i]))  # bottom
            f = bm.faces.new((bo[i], bo[j], to[j], to[i]))  # outer
            f.smooth = True
            f = bm.faces.new((ti[i], ti[j], bi[j], bi[i]))  # inner
            f.smooth = True
        _sharp_caps(bm)
        self.add(bm, m, axis_m(axis, pos))

    def square_ring(self, half, r_in, depth, pos=(0, 0, 0), m=None, axis="z", seg=48, corner=0.0):
        """Square plate with a round hole (fan frame face). half = half the outer side."""
        seg = max(8, seg - seg % 8)
        bm = bmesh.new()
        layers = []
        for z in (-depth / 2, depth / 2):
            inner = [bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), z)) for a in _angles(seg)]
            outer = []
            for a in _angles(seg):
                c, s = math.cos(a), math.sin(a)
                k = half / max(abs(c), abs(s))
                x, y = c * k, s * k
                if corner > 0 and abs(abs(x) - half) < 1e-4 and abs(abs(y) - half) < 1e-4:
                    x -= math.copysign(corner * 0.3, x)
                    y -= math.copysign(corner * 0.3, y)
                outer.append(bm.verts.new((x, y, z)))
            layers.append((inner, outer))
        (bi, bo), (ti, to) = layers
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((to[i], to[j], ti[j], ti[i]))
            bm.faces.new((bi[i], bi[j], bo[j], bo[i]))
            bm.faces.new((bo[i], bo[j], to[j], to[i]))
            f = bm.faces.new((ti[i], ti[j], bi[j], bi[i]))
            f.smooth = True
        _sharp_caps(bm)
        self.add(bm, m, axis_m(axis, pos))

    def pipe(self, points, radius, m=None, bend=0.0, seg=10, caps=True):
        """Round tube along a polyline (corners filleted with radius `bend`)."""
        pts = fillet(points, bend) if bend > 0 else [Vector(p) for p in points]
        bm = bmesh.new()
        rings = []
        prev_n = None
        for i, p in enumerate(pts):
            if i == 0:
                t = (pts[1] - pts[0]).normalized()
            elif i == len(pts) - 1:
                t = (pts[-1] - pts[-2]).normalized()
            else:
                t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
            if prev_n is None:
                ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
                n = t.cross(ref).normalized()
            else:
                n = (prev_n - t * prev_n.dot(t)).normalized()
            prev_n = n
            b = t.cross(n)
            rings.append([bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radius) for a in _angles(seg)])
        for r0, r1 in zip(rings, rings[1:]):
            for i in range(seg):
                j = (i + 1) % seg
                f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
                f.smooth = True
        if caps:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
            _sharp_caps(bm)
        self.add(bm, m)

    def blade_fan(self, r_hub, r_tip, depth, blades, m=None, pitch=32.0, sweep=28.0, chord=0.95, steps=6):
        """Curved fan blades around +Z (canonical). chord = fraction of the sector each blade covers."""
        for k in range(blades):
            base = 2 * math.pi * k / blades
            bm = bmesh.new()
            top, bot = [], []
            for s in range(steps + 1):
                u = s / steps
                rad = r_hub + (r_tip - r_hub) * u
                span = (2 * math.pi / blades) * chord * (0.75 + 0.25 * u)
                c = base + math.radians(sweep) * u
                a1, a2 = c - span / 2, c + span / 2
                h = depth * 0.5 * math.sin(math.radians(pitch + 10 * (1 - u)))
                t = 0.7
                lead = Vector((rad * math.cos(a1), rad * math.sin(a1), -h))
                trail = Vector((rad * math.cos(a2), rad * math.sin(a2), h))
                top.append((bm.verts.new(lead + Vector((0, 0, t))), bm.verts.new(trail + Vector((0, 0, t)))))
                bot.append((bm.verts.new(lead), bm.verts.new(trail)))
            for s in range(steps):
                (a, b), (c_, d) = top[s], top[s + 1]
                f = bm.faces.new((a, b, d, c_))
                f.smooth = True
                (a, b), (c_, d) = bot[s], bot[s + 1]
                f = bm.faces.new((c_, d, b, a))
                f.smooth = True
                bm.faces.new((top[s][0], top[s + 1][0], bot[s + 1][0], bot[s][0]))
                bm.faces.new((bot[s][1], bot[s + 1][1], top[s + 1][1], top[s][1]))
            bm.faces.new((top[-1][0], top[-1][1], bot[-1][1], bot[-1][0]))
            bm.faces.new((bot[0][0], bot[0][1], top[0][1], top[0][0]))
            self.add(bm, m)

    # finish ---------------------------------------------------------------------------
    def finish(self, collection=None, location=(0, 0, 0)) -> bpy.types.Object:
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-4)
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        obj = bpy.data.objects.new(self.name, me)
        obj.location = location
        (collection or bpy.context.scene.collection).objects.link(obj)
        return obj


def _angles(n):
    return [2 * math.pi * i / n for i in range(n)]


def _smooth_sides(bm, smooth=True):
    for f in bm.faces:
        side = abs(f.normal.z) < 0.5
        f.smooth = smooth and side
    _sharp_caps(bm)


def _sharp_caps(bm):
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.link_faces[0].smooth != e.link_faces[1].smooth:
            e.smooth = False


def fillet(points, r, n=5):
    """Replace polyline corners with arcs of radius r."""
    P = [Vector(p) for p in points]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1, d2 = (a - b), (c - b)
        l1, l2 = d1.length, d2.length
        if l1 < 1e-6 or l2 < 1e-6:
            continue
        d1n, d2n = d1 / l1, d2 / l2
        ang = d1n.angle(d2n)
        if ang > math.pi - 1e-3:
            out.append(b)
            continue
        t = min(r / math.tan(ang / 2), l1 * 0.5, l2 * 0.5)
        p1, p2 = b + d1n * t, b + d2n * t
        for k in range(n + 1):
            s = k / n
            # quadratic bezier approximates the arc well enough for cables
            q = p1 * (1 - s) ** 2 + b * 2 * (1 - s) * s + p2 * s * s
            out.append(q)
    out.append(P[-1])
    return out


# --------------------------------------------------------------------------------------------
# composite helpers (canonical frames documented on each)


def screw(p: Part, pos, r=3.0, axis="z", m_head=None, m_slot=None, h=1.6):
    """Pan-head screw sitting on a surface whose normal is `axis`. pos = surface point."""
    with p.at(axis_m(axis, pos)):
        p.cyl(r, h, (0, 0, h / 2), m_head, seg=20, r2=r * 0.85)
        p.box((r * 1.3, r * 0.28, 0.3), (0, 0, h + 0.05), m_slot)
        p.box((r * 0.28, r * 1.3, 0.3), (0, 0, h + 0.05), m_slot)


def standoff(p: Part, pos, h=6.2, m=None, axis="z"):
    with p.at(axis_m(axis, pos)):
        p.cyl(2.75, h, (0, 0, h / 2), m, seg=6, smooth=False)


def fan(p: Part, size=120.0, depth=25.0, m_frame=None, m_blade=None, m_hub=None, m_dark=None, blades=7, struts=True):
    """Axial case fan, canonical: airflow along +Z, centred at origin, frame face in XY."""
    h = size / 2
    r_in = h * 0.94
    lip = 2.2
    # thin front/back plates + body ring = classic frame look
    p.square_ring(h, r_in, lip, (0, 0, depth / 2 - lip / 2), m_frame, corner=6)
    p.square_ring(h, r_in, lip, (0, 0, -depth / 2 + lip / 2), m_frame, corner=6)
    p.annulus(r_in, r_in + 2.2, depth - 2 * lip + 0.2, (0, 0, 0), m_frame, seg=48)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = (sx * (h - 7.5), sy * (h - 7.5))
            p.cyl(5.5, depth - 2 * lip, (c[0], c[1], 0), m_frame, seg=16)
            for zz in (depth / 2, -depth / 2):
                p.cyl(2.3, 0.4, (c[0], c[1], zz + (0.05 if zz > 0 else -0.05)), m_dark, seg=14)
    r_hub = h * 0.36
    p.cyl(r_hub, depth * 0.62, (0, 0, depth * 0.06), m_hub, seg=40)
    p.cyl(r_hub * 0.82, 0.4, (0, 0, depth * 0.37 + 0.2), m_dark, seg=40)
    p.blade_fan(r_hub * 0.96, r_in - 1.2, depth * 0.55, blades, m_blade)
    if struts:
        for k in range(4):
            a = 45 + 90 * k
            with p.at(xf((0, 0, -depth / 2 + 1.6), (0, 0, a))):
                p.box((h * 1.3, 2.2, 2.4), (h * 0.65, 0, 0), m_frame, bevel=0.6)
        p.cyl(r_hub * 0.9, 3.0, (0, 0, -depth / 2 + 1.6), m_frame, seg=32)


def fin_stack(p: Part, size, count, thick=0.4, m=None, axis="z"):
    """Thin plates stacked along `axis` inside an AABB of `size` centred at origin."""
    k = "xyz".index(axis)
    pitch = size[k] / count
    for i in range(count):
        c = [0.0, 0.0, 0.0]
        c[k] = -size[k] / 2 + pitch * (i + 0.5)
        s = list(size)
        s[k] = thick
        p.box(s, c, m)


def grille(p: Part, r, rings=5, wire=1.2, m=None, axis="z", spokes=4, pos=(0, 0, 0)):
    """Wire fan guard: concentric rings and spokes on a plane normal to `axis`."""
    with p.at(axis_m(axis, pos)):
        for i in range(1, rings + 1):
            rr = r * i / rings
            p.annulus(rr - wire / 2, rr + wire / 2, wire, (0, 0, 0), m, seg=max(24, int(rr * 1.2)))
        for k in range(spokes):
            with p.at(xf((0, 0, 0), (0, 0, 45 + 180 / spokes * k))):
                p.box((2 * r, wire, wire), (0, 0, 0), m)


def slot_grid(p: Part, area, nx, ny, slot, m=None, pos=(0, 0, 0)):
    """Grid of small boxes (vent slots / dots) on the XY plane. area=(w,h), slot=(sx,sy,sz)."""
    w, h = area
    for i in range(nx):
        for j in range(ny):
            x = -w / 2 + w * (i + 0.5) / nx
            y = -h / 2 + h * (j + 0.5) / ny
            p.box(slot, (pos[0] + x, pos[1] + y, pos[2]), m)


def smd_scatter(p: Part, rect, z, count, mats, seed=1, size=(1.6, 0.8, 0.6)):
    """Small SMD parts scattered on a board face. rect=(x0,x1,y0,y1) in the current frame."""
    rnd = random.Random(seed)
    x0, x1, y0, y1 = rect
    for _ in range(count):
        s = rnd.choice([1.0, 1.0, 1.4, 2.0])
        sz = (size[0] * s, size[1] * s, size[2])
        rot = rnd.choice([0, 90])
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        p.box(sz, (x, y, z + size[2] / 2), rnd.choice(mats), rot=(0, 0, rot))


def pin_block(p: Part, cols, rows, pitch=4.2, depth=8.0, m_body=None, m_hole=None, latch=True, wall=1.0):
    """Molex-style connector housing. Canonical: mating face +Z (top at z=depth), cols along X, rows along Y."""
    w = cols * pitch + 2 * wall
    h = rows * pitch + 2 * wall
    p.box((w, h, depth), (0, 0, depth / 2), m_body, bevel=0.5)
    for i in range(cols):
        for j in range(rows):
            x = -cols * pitch / 2 + pitch * (i + 0.5)
            y = -rows * pitch / 2 + pitch * (j + 0.5)
            p.box((pitch * 0.72, pitch * 0.72, 0.6), (x, y, depth + 0.05), m_hole, bevel=0.3)
    if latch:
        p.box((pitch * 1.2, 1.6, depth * 0.6), (0, h / 2 + 0.8, depth * 0.55), m_body, bevel=0.3)


def plug(p: Part, cols, rows, pitch=4.2, depth=14.0, m_body=None, m_wire=None, wire_len=18.0, latch=True):
    """Cable plug with its wires. Canonical: inserts along -Z (mating face at z=0), wires leave +Z."""
    wall = 1.0
    w = cols * pitch + 2 * wall
    h = rows * pitch + 2 * wall
    p.box((w, h, depth), (0, 0, depth / 2), m_body, bevel=0.8)
    for i in range(cols):
        x = -cols * pitch / 2 + pitch * (i + 0.5)
        p.box((pitch * 0.8, h - 1.2, 1.2), (x, 0, depth * 0.5), m_body, bevel=0.3)  # ribs
    if latch:
        p.box((pitch * 1.3, 2.0, depth * 0.85), (0, h / 2 + 1.0, depth * 0.5), m_body, bevel=0.4)
        p.box((pitch * 1.3, 3.0, 2.0), (0, h / 2 + 1.5, depth * 0.85), m_body, bevel=0.4)
    for i in range(cols):
        for j in range(rows):
            x = -cols * pitch / 2 + pitch * (i + 0.5)
            y = -rows * pitch / 2 + pitch * (j + 0.5)
            p.cyl(pitch * 0.36, wire_len, (x, y, depth + wire_len / 2), m_wire, seg=10)


def dimm_module(p: Part, length=133.35, height=31.25, notch_from_left=71.0, mats=None, spreader=True, seed=3):
    """DDR4 DIMM. Canonical: length along Y, height along +Z (fingers at z=-height/2), thickness along X.

    notch_from_left: key position measured from the -Y end (DDR4: 71.0 mm of 133.35).
    mats: dict with pcb, chip, gold, spreader, spreader2, accent.
    """
    t = 1.27
    y0 = -length / 2
    nz = -height / 2
    p.box((t, length, height - 1.0), (0, 0, 0.5), mats["pcb"], bevel=0.3, round_axis="x")
    # gold fingers: two banks split by the key notch
    ny = y0 + notch_from_left
    for a, b in ((y0 + 2.5, ny - 1.0), (ny + 1.0, -y0 - 2.5)):
        n = int((b - a) / 0.85)
        for i in range(n):
            y = a + (i + 0.5) * (b - a) / n
            for sx in (-1, 1):
                p.box((0.06, 0.55, 3.6), (sx * (t / 2 + 0.03), y, nz + 1.0 + 1.8), mats["gold"])
    # board edge below the fingers (the notch is a gap)
    p.box((t, ny - 1.0 - y0, 1.0), ((0), (y0 + ny - 1.0) / 2, nz + 0.5), mats["pcb"])
    p.box((t, -y0 - (ny + 1.0), 1.0), (0, (ny + 1.0 - y0) / 2, nz + 0.5), mats["pcb"])
    if spreader:
        hs = height - 7.0
        for sx in (-1, 1):
            with p.at(xf((sx * (t / 2 + 1.0), 0, nz + 7.0 + hs / 2))):
                p.box((1.6, length - 1.0, hs), (0, 0, 0), mats["spreader"], bevel=0.7)
                p.box((0.4, length - 20, hs * 0.38), (sx * 0.9, 0, -hs * 0.12), mats["spreader2"], bevel=0.15)
                p.box((0.3, length - 22, 1.2), (sx * 1.0, 0, hs * 0.24), mats["accent"])
        p.box((t + 4.6, length - 1.0, 3.0), (0, 0, height / 2 + 0.5), mats["spreader"], bevel=1.2)
    else:
        for i in range(8):
            y = y0 + 8 + i * (length - 16) / 7.6
            for sx in (-1, 1):
                p.box((1.0, 10, 12), (sx * (t / 2 + 0.5), y, 0), mats["chip"], bevel=0.3)


def m2_2280(p: Part, mats, length=80.0, width=22.0, seed=5):
    """M.2 2280 M-key SSD. Canonical: connector at -X, PCB in XY, components on +Z, PCB z in [-0.4, 0.4]."""
    t = 0.8
    x0 = -length / 2
    # PCB with half-moon screw notch at +X end
    p.box((length - 4.0, width, t), (-2.0, 0, 0), mats["pcb"], bevel=0.2, round_axis="z")
    p.box((4.0, width * 0.32, t), (length / 2 - 2.0, width * 0.34, 0), mats["pcb"], bevel=0.2)
    p.box((4.0, width * 0.32, t), (length / 2 - 2.0, -width * 0.34, 0), mats["pcb"], bevel=0.2)
    p.annulus(1.6, 2.5, t + 0.05, (length / 2 - 2.6, 0, 0), mats["gold"], seg=20)
    # M key: notch 1.1 mm wide, centre 19.85 from one edge? spec: 5.3 mm from the M-key side -> show at +Y side
    key_y = width / 2 - 6.6
    fy = [(-width / 2 + 1.0, key_y - 0.6), (key_y + 0.6, width / 2 - 1.0)]
    for a, b in fy:
        n = max(1, int((b - a) / 0.5))
        for i in range(n):
            y = a + (i + 0.5) * (b - a) / n
            for sz in (-1, 1):
                p.box((3.4, 0.3, 0.05), (x0 + 1.9, y, sz * (t / 2 + 0.025)), mats["gold"])
    # controller, DRAM, NAND x2, label
    p.box((10.5, 10.5, 1.1), (x0 + 15.0, 0, t / 2 + 0.55), mats["chip"], bevel=0.25)
    p.box((7.0, 9.0, 0.9), (x0 + 26.5, 0, t / 2 + 0.45), mats["chip"], bevel=0.2)
    p.box((14.0, 16.0, 1.2), (x0 + 40.0, 0, t / 2 + 0.6), mats["chip"], bevel=0.25)
    p.box((14.0, 16.0, 1.2), (x0 + 57.0, 0, t / 2 + 0.6), mats["chip"], bevel=0.25)
    p.box((44.0, 18.0, 0.08), (x0 + 46.0, 0, t / 2 + 1.24), mats["label"])
    p.box((10.0, 1.2, 0.09), (x0 + 30.0, 5.5, t / 2 + 1.25), mats["accent"])
    smd_scatter(p, (x0 + 6, x0 + 9, -width / 2 + 2, width / 2 - 2), t / 2, 10, [mats["smd"], mats["smd2"]], seed=seed)


def dimm_slot(p: Part, length=144.0, m_body=None, m_latch=None, m_slot=None, latch_open=False):
    """DIMM socket with latches at both ends. Canonical: length along Y, rises +Z from z=0, opening on top."""
    w, h = 6.6, 7.6
    p.box((w, length - 12, h), (0, 0, h / 2), m_body, bevel=0.4)
    p.box((1.6, length - 16, 0.6), (0, 0, h + 0.05), m_slot)
    for sy in (-1, 1):
        with p.at(xf((0, sy * (length / 2 - 3.0), 0))):
            p.box((w + 0.4, 6.0, h + 3.2), (0, 0, (h + 3.2) / 2), m_latch, bevel=0.6)
            p.box((w - 1.0, 2.0, 2.5), (0, sy * 2.6, h + 3.0), m_latch, bevel=0.5)


def pcie_x16_slot(p: Part, m_body=None, m_latch=None, m_slot=None, m_metal=None, armored=True):
    """PCIe x16 socket. Canonical: length along X (key end at -X), rises +Z from z=0."""
    L, w, h = 89.0, 7.6, 11.2
    if armored:
        p.box((L + 1.2, w + 1.2, h - 1.0), (0, 0, (h - 1.0) / 2), m_metal, bevel=0.5)
    p.box((L, w, h), (0, 0, h / 2), m_body, bevel=0.5)
    p.box((L - 4.0, 1.8, 0.6), (0.8, 0, h + 0.05), m_slot)
    p.box((0.8, w + 0.2, 0.7), (-L / 2 + 11.65, 0, h + 0.1), m_body)  # key bridge
    with p.at(xf((L / 2 + 3.6, 0, 0))):
        p.box((7.0, w + 0.6, h - 1.0), (0, 0, (h - 1.0) / 2), m_latch, bevel=0.8)
        p.box((5.0, w + 0.6, 2.0), (1.4, 0, h - 1.0), m_latch, bevel=0.7)


def m2_socket(p: Part, m_body=None, m_slot=None):
    """M.2 socket. Canonical: card enters along +X; socket body centred at origin, sits on z=0."""
    p.box((5.5, 23.0, 4.2), (0, 0, 2.1), m_body, bevel=0.4)
    p.box((1.0, 19.5, 1.0), (2.2, 0, 2.6), m_slot)


def label_text(p: Part, text, size, pos, m, depth=0.2, rot=(0, 0, 0), align="CENTER"):
    """Extruded text mesh (built-in font). Canonical text plane XY, facing +Z."""
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = text
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = align
    cu.align_y = "CENTER"
    ob = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    p.add(bm, m, xf(pos, rot), smooth=False)


def bundle(points, offsets, bend=0.0):
    """Parallel paths around a centreline. offsets: list of (u, v) in the path's normal plane.

    The frame is transported along the filleted centreline, so the wires stay side by side
    through bends. Returns one point list per offset.
    """
    pts = fillet(points, bend) if bend > 0 else [Vector(p) for p in points]
    frames = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        if prev_n is None:
            ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = n
        frames.append((p, n, t.cross(n)))
    return [[p + n * u + b * v for (p, n, b) in frames] for (u, v) in offsets]


def grid_offsets(cols, rows, pitch):
    return [
        ((i - (cols - 1) / 2) * pitch, (j - (rows - 1) / 2) * pitch) for i in range(cols) for j in range(rows)
    ]
