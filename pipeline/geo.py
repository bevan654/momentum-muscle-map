"""Geometry toolkit for cutting MuscleMap shapes into finer regions."""
import re, math
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, GeometryCollection
from shapely.ops import unary_union
from shapely.validation import make_valid
from shapely import affinity, set_precision
import mm

SUB = re.compile(r"M[^M]*")


def clean(g, min_area=0.3):
    ps = [p for p in mm.polys_of(g) if p.area > min_area]
    if not ps:
        return Polygon()
    return ps[0] if len(ps) == 1 else MultiPolygon(ps)


class Sub:
    """One sub-path (M…Z) of an original MuscleMap muscle path."""
    def __init__(self, shape_i, j, d, group, mid):
        self.shape = shape_i
        self.j = j
        self.d = d.strip()
        self.group = group
        self.mid = mid
        rings = mm.path_rings(self.d, n=8)
        polys = []
        for r in rings:
            r = np.round(r, 2)
            p = Polygon(r)
            if not p.is_valid:
                p = make_valid(p)
            polys.append(p)
        self.geom = clean(unary_union(polys))
        self.used = False

    @property
    def key(self):
        return f"{self.shape}.{self.j}"


class Body:
    def __init__(self, name):
        self.name = name
        D = mm.load(name)
        self.cx = D["centerX"]
        self.viewBox = D["viewBox"]
        self.outline_d = [o["d"] for o in D["outline"]]
        self.outline = unary_union([mm.path_geom(d, n=8) for d in self.outline_d])
        self.subs = []
        self.shapes = []
        for i, m in enumerate(D["muscles"]):
            subs = []
            for j, sd in enumerate(SUB.findall(m["d"])):
                s = Sub(i, j, sd, m["group"], m["id"])
                if s.geom.is_empty:
                    continue
                subs.append(s)
            # stable order: largest first
            subs.sort(key=lambda s: -s.geom.area)
            for j, s in enumerate(subs):
                s.j = j
            # the source art lets a few abutting sub-paths overlap by a hair:
            # give the overlap to the larger one so regions never overlap
            for j, s in enumerate(subs):
                s.modified = False
                prev = unary_union([q.geom for q in subs[:j]]) if j else None
                if prev is not None and s.geom.intersection(prev).area > 0.05:
                    s.geom = clean(s.geom.difference(prev))
                    s.modified = True
            # when one sub-path was trimmed, emit the whole shape from the same
            # flattened geometry so the shared edges stay identical
            flat = any(s.modified for s in subs)
            for s in subs:
                s.flat = flat
            self.subs.extend(subs)
            self.shapes.append({"i": i, "group": m["group"], "id": m["id"], "d": m["d"], "subs": subs,
                                "geom": clean(unary_union([s.geom for s in subs]))})
        self.all = unary_union([s.geom for s in self.subs])
        self._pair()

    def _pair(self):
        """Match every image-left sub-path to its image-right counterpart."""
        L = [s for s in self.subs if s.geom.centroid.x < self.cx]
        R = [s for s in self.subs if s.geom.centroid.x >= self.cx]
        cand = []
        for l in L:
            ml = affinity.scale(l.geom, xfact=-1, yfact=1, origin=(self.cx, 0))
            for r in R:
                if r.group != l.group:
                    continue
                inter = ml.intersection(r.geom).area
                iou = inter / (ml.area + r.geom.area - inter)
                dist = ml.centroid.distance(r.geom.centroid)
                cand.append((-(iou - dist / 1000.0), l.key, r.key, l, r, iou, dist))
        cand.sort(key=lambda c: c[0])
        self.pair, usedr = {}, set()
        for _, lk, rk, l, r, iou, dist in cand:
            if lk in self.pair or rk in usedr or dist > 40:
                continue
            self.pair[lk] = r
            usedr.add(rk)
        self.unpaired = [s.key for s in L if s.key not in self.pair] + [s.key for s in R if s.key not in usedr]

    def at(self, x, y, tol=7):
        """Sub-path containing (or nearest to) a point."""
        pt = Point(x, y)
        best, bd = None, 1e9
        for s in self.subs:
            d = s.geom.distance(pt)
            if d < bd:
                best, bd = s, d
        if bd > tol:
            raise KeyError(f"{self.name}: no sub-path near ({x},{y}) (nearest {best.key} at {bd:.1f})")
        return best


# ---------------------------------------------------------------- frames
class Frame:
    """Normalised (a, t) coordinates: a = medial->lateral, t = top->bottom."""
    def __init__(self, geom, cx, kind="bbox", angle=None):
        self.geom = geom
        pts = np.vstack([np.asarray(p.exterior.coords) for p in mm.polys_of(geom)])
        lat = 1.0 if geom.centroid.x > cx else -1.0
        if kind == "bbox":
            ut = np.array([0.0, 1.0])
        elif kind == "pca":
            c = pts.mean(axis=0)
            # area-weighted would be nicer; boundary PCA is adequate for these blobs
            w, v = np.linalg.eigh(np.cov((pts - c).T))
            ut = v[:, np.argmax(w)]
            if ut[1] < 0:
                ut = -ut
        else:
            raise ValueError(kind)
        if angle is not None:  # explicit long-axis direction, degrees clockwise from "down"
            th = math.radians(angle)
            ut = np.array([math.sin(th) * lat, math.cos(th)])
        ua = np.array([ut[1], -ut[0]])
        if ua[0] * lat < 0:
            ua = -ua
        self.ut, self.ua = ut, ua
        pa, pt_ = pts @ ua, pts @ ut
        self.a0, self.a1 = pa.min(), pa.max()
        self.t0, self.t1 = pt_.min(), pt_.max()

    def w(self, a, t):
        A = self.a0 + a * (self.a1 - self.a0)
        T = self.t0 + t * (self.t1 - self.t0)
        return A * self.ua + T * self.ut

    def n(self, x, y):
        p = np.array([x, y])
        return ((p @ self.ua - self.a0) / (self.a1 - self.a0), (p @ self.ut - self.t0) / (self.t1 - self.t0))


def catmull(pts, n=12):
    pts = [np.asarray(p, float) for p in pts]
    if len(pts) < 3:
        return pts
    P = [2 * pts[0] - pts[1]] + pts + [2 * pts[-1] - pts[-2]]
    out = [pts[0]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(1, n + 1):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out


def rnd(pts):
    return [(round(float(p[0]), 1), round(float(p[1]), 1)) for p in pts]


def side_poly(line, far=4000.0):
    p0, pn = np.array(line[0]), np.array(line[-1])
    d = pn - p0
    d = d / np.linalg.norm(d)
    nrm = np.array([-d[1], d[0]])
    ring = list(line) + [tuple(pn + d * far), tuple(pn + d * far + nrm * far), tuple(p0 - d * far + nrm * far), tuple(p0 - d * far)]
    sp = Polygon(ring)
    if not sp.is_valid:
        sp = make_valid(sp)
    return sp


def _extend(line, amount=40.0):
    line = [np.asarray(p, float) for p in line]
    d0 = line[0] - line[1]; d0 /= (np.linalg.norm(d0) or 1)
    d1 = line[-1] - line[-2]; d1 /= (np.linalg.norm(d1) or 1)
    return [line[0] + d0 * amount] + line + [line[-1] + d1 * amount]


def _tidy(A, B, frac=0.06):
    """Move small detached chips to the side they actually touch."""
    def chips(g, other):
        ps = sorted(mm.polys_of(g), key=lambda p: -p.area)
        if len(ps) < 2:
            return g, other
        keep, move = [ps[0]], []
        for p in ps[1:]:
            if p.area < frac * ps[0].area and p.buffer(0.2).intersects(other):
                move.append(p)
            else:
                keep.append(p)
        if move:
            other = clean(unary_union([other] + [m.buffer(0.02) for m in move]).buffer(-0.0))
            other = clean(unary_union([other] + move))
        return clean(unary_union(keep)) if len(keep) > 1 else keep[0], other
    A, B = chips(A, B)
    B, A = chips(B, A)
    return A, B


def cut_line(geom, line):
    line = rnd(_extend(line))
    sp = side_poly(line)
    A = clean(geom.intersection(sp))
    B = clean(geom.difference(sp))
    return _tidy(A, B)


def cut(geom, fr, pts, order="t", smooth=True):
    """Cut with a curve through normalised (a, t) points. Returns the two sides
    ordered by centroid along `order` ('t': top first, 'a': medial first)."""
    wp = [fr.w(a, t) for a, t in pts]
    line = catmull(wp) if smooth else wp
    A, B = cut_line(geom, line)
    if A.is_empty or B.is_empty:
        raise ValueError("cut missed the shape")
    k = 1 if order == "t" else 0
    ca, cb = fr.n(*A.representative_point().coords[0])[k], fr.n(*B.representative_point().coords[0])[k]
    ca, cb = fr.n(A.centroid.x, A.centroid.y)[k], fr.n(B.centroid.x, B.centroid.y)[k]
    return (A, B) if ca <= cb else (B, A)


def lsplit(geom, fr, fracs, t_from=0.0, t_to=1.0, samples=28):
    """Longitudinal split following the shape: at each station t the cut sits at
    fraction f(t) of the local width (medial->lateral). Returns (medial, lateral)."""
    if not isinstance(fracs, (list, tuple)):
        fracs = [(0.0, fracs), (1.0, fracs)]
    ft = np.array([f[0] for f in fracs]); fv = np.array([f[1] for f in fracs])
    pts = []
    W = (fr.a1 - fr.a0)
    for t in np.linspace(max(t_from, 0.03), min(t_to, 0.97), samples):
        p0 = fr.w(-0.5, t); p1 = fr.w(1.5, t)
        inter = geom.intersection(LineString([p0, p1]))
        if inter.is_empty:
            continue
        xs = []
        for g in getattr(inter, "geoms", [inter]):
            for c in g.coords:
                xs.append(np.array(c) @ fr.ua)
        lo, hi = min(xs), max(xs)
        f = float(np.interp(t, ft, fv))
        A = lo + f * (hi - lo)
        T = fr.t0 + t * (fr.t1 - fr.t0)
        pts.append(A * fr.ua + T * fr.ut)
    # light smoothing
    sm = [pts[0]] + [(pts[i - 1] + 2 * pts[i] + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
    A, B = cut_line(geom, sm)
    ca, cb = fr.n(A.centroid.x, A.centroid.y)[0], fr.n(B.centroid.x, B.centroid.y)[0]
    return (A, B) if ca <= cb else (B, A)


def mirror(g, cx):
    return affinity.scale(g, xfact=-1, yfact=1, origin=(cx, 0))
