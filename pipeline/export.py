"""Validate the cut regions and export the JSON the page embeds."""
import sys, json, re, math
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union, polylabel
import shapely
import geo, mm, build
from build import H

def fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s

def ring_d(coords):
    pts = []
    for x, y in coords:
        p = (round(float(x), 1), round(float(y), 1))
        if not pts or pts[-1] != p:
            pts.append(p)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    if len(pts) < 3:
        return ""
    return "M" + "L".join(f"{fmt(x)} {fmt(y)}" for x, y in pts) + "Z"

def poly_d(g):
    out = []
    for p in mm.polys_of(g):
        if p.area < 0.3:
            continue
        p = shapely.geometry.polygon.orient(p, 1.0)
        out.append(ring_d(p.exterior.coords))
        for r in p.interiors:
            if Polygon(r).area > 0.3:
                out.append(ring_d(r.coords))
    return "".join(out)

def sub_d(sub):
    """Original sub-path text, re-emitted compactly (already 1 decimal)."""
    d = re.sub(r"\s+", " ", sub.d.strip())
    d = re.sub(r"\s*([MLCZ])\s*", r"\1", d)
    return d

def piece_d(p):
    if p["kind"] == "sub" and not p["sub"].flat:
        return sub_d(p["sub"])
    return poly_d(p["geom"])

def tidy(g):
    return geo.clean(g.simplify(0.04), 0.3)

def anchor(g):
    big = max(mm.polys_of(g), key=lambda p: p.area)
    try:
        pt = polylabel(big, tolerance=1.0)
    except Exception:
        pt = big.representative_point()
    return [round(pt.x, 1), round(pt.y, 1)]

report = []
def validate(name, B, regions):
    ok = True
    # every source sub-path consumed
    unused = [s.key for s in B.subs if not s.used]
    # tiling per original shape, measured on the EMITTED (rounded) geometry
    by_shape = {}
    for r in regions:
        for p in r["pieces"]:
            if p["shape"] is not None:
                by_shape.setdefault(p["shape"], []).append((r["slug"], mm.path_geom(piece_d(p), n=8)))
    worst_sum = worst_sym = 0.0
    nsplit = 0
    for sh in B.shapes:
        ps = by_shape.get(sh["i"], [])
        orig = mm.path_geom(sh["d"], n=8)
        if not ps:
            report.append(f"  !! {name}: shape {sh['i']} {sh['group']} has no regions"); ok = False; continue
        ssum = sum(g.area for _, g in ps)
        uni = unary_union([g for _, g in ps])
        e_sum = 100 * (ssum - orig.area) / orig.area
        e_sym = 100 * uni.symmetric_difference(orig).area / orig.area
        worst_sum = max(worst_sum, abs(e_sum)); worst_sym = max(worst_sym, e_sym)
        if len(ps) > 1: nsplit += 1
        if abs(e_sum) > 0.5 or e_sym > 0.5:
            report.append(f"  !! {name}: shape {sh['i']} {sh['group']} area sum {e_sum:+.3f}% sym-diff {e_sym:.3f}% ({len(ps)} pieces)"); ok = False
    # pairwise overlaps between final regions
    gs = [(r["slug"], mm.path_geom(r["d"], n=8)) for r in regions]
    worst_ov = 0.0
    shp = {r["slug"]: {p["shape"] for p in r["pieces"]} for r in regions}
    inherited = []
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            if gs[i][1].bounds[2] < gs[j][1].bounds[0] or gs[j][1].bounds[2] < gs[i][1].bounds[0]:
                continue
            ov = gs[i][1].intersection(gs[j][1]).area
            if ov <= 0.3:
                worst_ov = max(worst_ov, ov); continue
            # is the overlap already present between the untouched source shapes?
            src = 0.0
            for a in shp[gs[i][0]]:
                for b in shp[gs[j][0]]:
                    if a is not None and b is not None and a != b:
                        src += mm.path_geom(B.shapes[a]["d"], n=8).intersection(mm.path_geom(B.shapes[b]["d"], n=8)).intersection(gs[i][1]).intersection(gs[j][1]).area
            if abs(src - ov) < max(0.6, 0.05 * ov):
                inherited.append(f"{gs[i][0]}/{gs[j][0]} {ov:.1f}")
            elif ov <= 1.5:   # sub-unit slivers from rounding shared edges to 0.1
                worst_ov = max(worst_ov, ov)
            else:
                worst_ov = max(worst_ov, ov)
                report.append(f"  !! {name}: overlap {gs[i][0]} / {gs[j][0]} = {ov:.2f} (source {src:.2f})"); ok = False
    if inherited:
        report.append(f"  {name}: overlaps inherited from the source paths (u²): " + "; ".join(inherited))
    # drawn regions stay inside the silhouette
    for r in regions:
        for p in r["pieces"]:
            if p["kind"] == "new":
                out = p["geom"].difference(B.outline).area
                if out > 0.01:
                    report.append(f"  !! {name}: drawn {r['slug']} leaves outline by {out:.2f}"); ok = False
    outside = sum(g.difference(B.outline).area for _, g in gs)
    report.append(f"  {name}: {len(regions)} regions | source shapes {len(B.shapes)} ({nsplit} split) | unused subs {unused or 'none'} | "
                  f"worst area-sum err {worst_sum:.3f}% | worst sym-diff {worst_sym:.3f}% | worst pair overlap {worst_ov:.3f} u² | art outside silhouette {outside:.1f} u² | {'OK' if ok else 'FAIL'}")
    return ok

def units(regions, key):
    """Merge parts into parent units (muscle or group level)."""
    out = {}
    for r in regions:
        k = r["slug"] if r["group"] == "connective" else f"{r[key]}_{r['side']}"
        out.setdefault(k, []).append(r)
    return out

def unit_d(B, rs, shape_total):
    by_shape, d = {}, []
    for r in rs:
        for p in r["pieces"]:
            by_shape.setdefault(p["shape"], []).append(p)
    for shp, ps in by_shape.items():
        if shp is None:
            d += [poly_d(p["geom"]) for p in ps]
        elif len(ps) == shape_total[shp]:
            sh = B.shapes[shp]
            d.append("".join(sub_d(s) if not s.flat else poly_d(tidy(s.geom)) for s in sh["subs"]))
        else:
            by_sub = {}
            for p in ps:
                by_sub.setdefault(p["subkey"], []).append(p)
            for key, qs in by_sub.items():
                if len(qs) == 1:
                    d.append(piece_d(qs[0]))
                else:  # sibling tiles of one sub-path: dissolve the seam
                    u = unary_union([q["geom"].buffer(0.06) for q in qs]).buffer(-0.06)
                    d.append(poly_d(tidy(u)))
    return "".join(d)

def main():
    data = {"bodies": {}}
    allok = True
    areas = {}
    for name in mm.BODIES:
        B, regions = build.build(name)
        for r in regions:
            for p in r["pieces"]:
                if p["kind"] != "sub" or p["sub"].flat:
                    p["geom"] = tidy(p["geom"])
            r["d"] = "".join(piece_d(p) for p in r["pieces"])
            g = mm.path_geom(r["d"], n=8)
            r["geom"] = g
            r["src"] = "drawn" if all(p["kind"] == "new" for p in r["pieces"]) else ("art" if all(p["kind"] == "sub" for p in r["pieces"]) else ("mixed" if any(p["kind"] == "new" for p in r["pieces"]) else "split"))
            areas.setdefault(r["base"], []).append(g.area)
        regions.sort(key=lambda r: max((p["shape"] if p["shape"] is not None else 999) for p in r["pieces"]))
        allok &= validate(name, B, regions)
        shape_total = {}
        for r in regions:
            for p in r["pieces"]:
                if p["shape"] is not None:
                    shape_total[p["shape"]] = shape_total.get(p["shape"], 0) + 1
        def rec(uid, d, rs):
            g = mm.path_geom(d, n=8)
            b = g.bounds
            return {"id": uid, "d": d, "c": anchor(g), "bb": [round(v, 1) for v in b], "a": round(g.area)}
        ob = B.outline.bounds
        body = {"viewBox": B.viewBox, "cx": B.cx, "ob": [round(v, 1) for v in ob], "outline": "".join(re.sub(r"\s*([MLCZ])\s*", r"\1", d.strip()) for d in B.outline_d), "L3": [], "L2": [], "L1": []}
        for r in regions:
            e = rec(r["slug"], r["d"], [r]); e.update({"slug": r["slug"], "base": r["base"], "parent": r["parent"], "group": r["group"], "side": r["side"], "src": r["src"]})
            body["L3"].append(e)
        for lvl, key in (("L2", "parent"), ("L1", "group")):
            for uid, rs in units(regions, key).items():
                d = rs[0]["d"] if len(rs) == 1 else unit_d(B, rs, shape_total)
                e = rec(uid, d, rs); e.update({"key": rs[0][key] if rs[0]["group"] != "connective" else rs[0]["base"], "group": rs[0]["group"], "side": rs[0]["side"], "kids": [r["slug"] for r in rs]})
                # merged unit must cover exactly its parts
                ua = mm.path_geom(d, n=8); pa = unary_union([r["geom"] for r in rs])
                err = 100 * ua.symmetric_difference(pa).area / pa.area
                if err > 0.5:
                    report.append(f"  !! {name} {lvl} {uid}: merged outline differs from parts by {err:.2f}%"); allok = False
                e["z"] = max((p["shape"] if p["shape"] is not None else 999) for r in rs for p in r["pieces"])
                body[lvl].append(e)
            body[lvl].sort(key=lambda e: e.pop("z"))
        report.append(f"      levels: groups {len(body['L1'])}, muscles {len(body['L2'])}, parts {len(body['L3'])}; path bytes {sum(len(e['d']) for l in ('L1','L2','L3') for e in body[l])}")
        data["bodies"][name] = body
    # roll-up weights from mean drawn area (view/sex independent)
    mean = {b: float(np.mean(a)) for b, a in areas.items()}
    data["hier"] = {b: {"muscle": H[b][0], "group": H[b][1]} for b in H}
    pw = {}
    for b in H:
        if b not in mean: continue
        sib = [mean[x] for x in H if H[x][0] == H[b][0] and x in mean]
        pw[b] = round(0.7 + 0.3 * math.sqrt(mean[b] / max(sib)), 2)
    msum = {}
    for b in mean:
        msum[H[b][0]] = msum.get(H[b][0], 0) + mean[b]
    mw = {}
    for m, a in msum.items():
        g = next(H[b][1] for b in H if H[b][0] == m)
        sib = [msum[x] for x in msum if next(H[b][1] for b in H if H[b][0] == x) == g]
        mw[m] = round(0.7 + 0.3 * math.sqrt(a / max(sib)), 2)
    data["pw"], data["mw"] = pw, mw
    print("\n".join(report))
    print("ALL OK" if allok else "VALIDATION FAILED")
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "data.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(data, open(out, "w"), separators=(",", ":"))
    print(out, os.path.getsize(out), "bytes")
    if not allok:
        sys.exit(1)

main()
