"""Shared helpers: read MuscleMap diagram data (as text, never executed),
parse SVG paths to shapely geometry, and render review PNGs."""
import re
import numpy as np
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
from shapely.validation import make_valid

import os
# Directory holding the unpacked @musclemap/assets dist files. They are read as text and never executed.
PKG = os.environ.get("MUSCLEMAP_DIST") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "musclemap", "package", "dist")
BODIES = ["male-front", "male-back", "female-front", "female-back"]

TOK = re.compile(r"([MmLlCcZzHhVvSsQqTtAa])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)")


def load(body):
    src = open(f"{PKG}/{body}.js", encoding="utf8").read()
    out_src, mus_src = src.split("const MUSCLES = [")
    outline = [
        {"id": m.group(1), "d": m.group(2)}
        for m in re.finditer(r'\{ id: "([^"]+)", side: "[^"]+", d: "([^"]+)" \}', out_src)
    ]
    muscles = []
    for m in re.finditer(r'\{ group: "([^"]+)", side: "([^"]+)",(?: id: "([^"]+)",)? d: "([^"]+)" \}', mus_src):
        muscles.append({"group": m.group(1), "side": m.group(2), "id": m.group(3), "d": m.group(4)})
    vb = re.search(r'viewBox: "([^"]+)"', src).group(1)
    cx = float(re.search(r"centerX: ([\d.]+)", src).group(1))
    return {"viewBox": vb, "centerX": cx, "outline": outline, "muscles": muscles}


def _bez(p0, p1, p2, p3, n=10):
    t = np.linspace(0, 1, n + 1)[1:, None]
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def path_rings(d, n=10):
    """Absolute M/L/C/Z path -> list of rings (np arrays)."""
    toks = TOK.findall(d)
    i = 0
    rings, cur, cmd = [], [], None
    pos = np.zeros(2)

    def num():
        nonlocal i
        v = float(toks[i][1])
        i += 1
        return v

    while i < len(toks):
        if toks[i][0]:
            cmd = toks[i][0]
            i += 1
            if cmd in "Zz":
                if len(cur) >= 3:
                    rings.append(np.array(cur))
                cur = []
                continue
        if cmd == "M":
            if len(cur) >= 3:
                rings.append(np.array(cur))
            pos = np.array([num(), num()])
            cur = [pos]
            cmd = "L"
        elif cmd == "L":
            pos = np.array([num(), num()])
            cur.append(pos)
        elif cmd == "C":
            p1 = np.array([num(), num()])
            p2 = np.array([num(), num()])
            p3 = np.array([num(), num()])
            cur.extend(list(_bez(pos, p1, p2, p3, n)))
            pos = p3
        else:
            raise ValueError("unsupported path command " + str(cmd))
    if len(cur) >= 3:
        rings.append(np.array(cur))
    return rings


def path_geom(d, n=10):
    polys = []
    for r in path_rings(d, n):
        p = Polygon(r)
        if not p.is_valid:
            p = make_valid(p)
        polys.append(p)
    # even-odd is not needed for this artwork; union the sub-paths
    g = unary_union(polys)
    return g


def polys_of(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


def draw(ax, g, **kw):
    from matplotlib.patches import PathPatch
    from matplotlib.path import Path
    for p in polys_of(g):
        verts, codes = [], []
        for ring in [p.exterior, *p.interiors]:
            xy = np.asarray(ring.coords)
            verts.extend(xy)
            codes.extend([Path.MOVETO] + [Path.LINETO] * (len(xy) - 2) + [Path.CLOSEPOLY])
        ax.add_patch(PathPatch(Path(verts, codes), **kw))
