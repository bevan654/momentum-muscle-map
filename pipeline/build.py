"""Cut the four MuscleMap bodies into the deep region set and export JSON."""
import sys, json, math
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, Point
from shapely.ops import unary_union
import geo, mm
from geo import Frame, cut, lsplit, clean

# slug -> (parent muscle, group)
H = {
    "sternocleidomastoid": ("sternocleidomastoid", "neck"),
    "levator_scapulae": ("levator_scapulae", "neck"),
    "trapezius_upper": ("trapezius", "traps"), "trapezius_mid": ("trapezius", "traps"), "trapezius_lower": ("trapezius", "traps"),
    "rhomboids": ("rhomboids", "traps"),
    "deltoid_anterior": ("deltoid", "shoulders"), "deltoid_lateral": ("deltoid", "shoulders"), "deltoid_posterior": ("deltoid", "shoulders"),
    "infraspinatus": ("infraspinatus", "shoulders"), "teres_minor": ("teres_minor", "shoulders"), "teres_major": ("teres_major", "shoulders"),
    "pectoralis_major_clavicular": ("pectoralis_major", "chest"), "pectoralis_major_sternal": ("pectoralis_major", "chest"),
    "pectoralis_major_abdominal": ("pectoralis_major", "chest"),
    "serratus_anterior_1": ("serratus_anterior", "chest"), "serratus_anterior_2": ("serratus_anterior", "chest"), "serratus_anterior_3": ("serratus_anterior", "chest"),
    "latissimus_dorsi_upper": ("latissimus_dorsi", "back"), "latissimus_dorsi_lower": ("latissimus_dorsi", "back"),
    "erector_spinae_iliocostalis": ("erector_spinae", "back"), "erector_spinae_longissimus": ("erector_spinae", "back"),
    "rectus_abdominis_upper": ("rectus_abdominis", "core"), "rectus_abdominis_mid": ("rectus_abdominis", "core"), "rectus_abdominis_lower": ("rectus_abdominis", "core"),
    "external_oblique": ("external_oblique", "core"), "internal_oblique": ("internal_oblique", "core"),
    "biceps_brachii_long_head": ("biceps_brachii", "arms"), "biceps_brachii_short_head": ("biceps_brachii", "arms"),
    "brachialis": ("brachialis", "arms"),
    "triceps_brachii_long_head": ("triceps_brachii", "arms"), "triceps_brachii_lateral_head": ("triceps_brachii", "arms"), "triceps_brachii_medial_head": ("triceps_brachii", "arms"),
    "anconeus": ("anconeus", "arms"),
    "brachioradialis": ("brachioradialis", "forearms"),
    "pronator_teres": ("forearm_flexors", "forearms"), "flexor_carpi_radialis": ("forearm_flexors", "forearms"), "wrist_flexor_group": ("forearm_flexors", "forearms"),
    "extensor_carpi_radialis": ("forearm_extensors", "forearms"), "extensor_digitorum": ("forearm_extensors", "forearms"), "extensor_carpi_ulnaris": ("forearm_extensors", "forearms"),
    "gluteus_maximus_upper": ("gluteus_maximus", "glutes"), "gluteus_maximus_lower": ("gluteus_maximus", "glutes"),
    "gluteus_medius": ("gluteus_medius", "glutes"), "tensor_fasciae_latae": ("tensor_fasciae_latae", "glutes"),
    "rectus_femoris": ("rectus_femoris", "quads"), "vastus_lateralis": ("vastus_lateralis", "quads"), "vastus_medialis": ("vastus_medialis", "quads"),
    "sartorius": ("sartorius", "quads"),
    "adductor_longus": ("adductor_longus", "adductors"), "adductor_magnus": ("adductor_magnus", "adductors"),
    "pectineus": ("pectineus", "adductors"), "gracilis": ("gracilis", "adductors"),
    "biceps_femoris_long_head": ("biceps_femoris", "hamstrings"), "biceps_femoris_short_head": ("biceps_femoris", "hamstrings"),
    "semitendinosus": ("semitendinosus", "hamstrings"), "semimembranosus": ("semimembranosus", "hamstrings"),
    "gastrocnemius_medial": ("gastrocnemius", "calves"), "gastrocnemius_lateral": ("gastrocnemius", "calves"),
    "soleus": ("soleus", "calves"), "tibialis_anterior": ("tibialis_anterior", "calves"), "peroneus_longus": ("peroneus_longus", "calves"),
    # non-muscle
    "thoracolumbar_fascia": ("thoracolumbar_fascia", "connective"), "achilles_tendon": ("achilles_tendon", "connective"),
    "patella": ("patella", "connective"),
}


class Half:
    """Recipe context for one image half of one body."""
    def __init__(self, B, view, img):
        self.B, self.view, self.img = B, view, img
        # subject's left is image-right from the front, image-left from the back
        self.side = ("left" if img == "R" else "right") if view == "front" else ("left" if img == "L" else "right")
        self.regions = {}

    def X(self, x):
        return x if self.img == "L" else 2 * self.B.cx - x

    def S(self, x, y, r=None):
        """Sub-path at an image-left point (mirrored for the right half);
        `r` is an explicit image-right point where the halves differ."""
        if self.img == "L":
            s = self.B.at(x, y)
        elif r:
            s = self.B.at(*r)
        else:
            s = self.B.pair[self.B.at(x, y).key]
        if s.used:
            raise RuntimeError(f"{self.B.name} {self.img}: sub {s.key} used twice (lookup {x},{y})")
        s.used = True
        return s

    def add(self, slug, *pieces):
        assert slug in H, slug
        lst = self.regions.setdefault(slug, [])
        for p in pieces:
            if isinstance(p, geo.Sub):
                lst.append({"kind": "sub", "sub": p, "shape": p.shape, "geom": p.geom, "subkey": p.key})
            elif isinstance(p, tuple):
                g, src = p
                key = src.key if isinstance(src, geo.Sub) else None
                if isinstance(src, geo.Sub):
                    src = src.shape
                lst.append({"kind": "cut" if src is not None else "new", "shape": src, "geom": g, "subkey": key})
            else:
                raise TypeError(p)

    def fr(self, g, kind="bbox", angle=None):
        if isinstance(g, geo.Sub):
            g = g.geom
        return Frame(g, self.B.cx, kind, angle)

    def drawn(self, pts, smooth=True, inset=1.4, gap=2.4, round_=1.6):
        P = [(self.X(x), y) for x, y in pts]
        if smooth:
            P = geo.catmull(P + P[:1], n=8)
        poly = Polygon(P).buffer(0)
        g = poly.intersection(self.B.outline.buffer(-inset)).difference(self.B.all.buffer(gap))
        for other in self.B.drawn:
            g = g.difference(other.buffer(gap))
        g = clean(g, 3)
        ps = sorted(mm.polys_of(g), key=lambda p: -p.area)
        g = ps[0]
        g = g.buffer(-round_).buffer(round_)  # round the corners left by clipping
        g = sorted(mm.polys_of(g), key=lambda p: -p.area)[0]
        g = clean(g, 3)
        self.B.drawn.append(g)
        return (g, None)


def both(B, view, fn):
    out = []
    for img in ("L", "R"):
        h = Half(B, view, img)
        fn(h)
        out.append(h)
    return out


# ============================================================== recipes
def pec_cuts(h, s, clav, abd):
    fr = h.fr(s)
    top, rest = cut(s.geom, fr, clav, "t")
    mid, bot = cut(rest, fr, abd, "t")
    h.add("pectoralis_major_clavicular", (top, s))
    h.add("pectoralis_major_sternal", (mid, s))
    h.add("pectoralis_major_abdominal", (bot, s))


def biceps_cuts(h, s, brach=((1.4, 0.44), (0.86, 0.60), (0.74, 0.82), (0.66, 1.25)), f=0.5):
    fr = h.fr(s, "pca")
    rest, br = cut(s.geom, fr, brach, "a")
    fr2 = h.fr(rest, "pca")
    short, long_ = lsplit(rest, fr2, f)
    h.add("brachialis", (br, s))
    h.add("biceps_brachii_short_head", (short, s))
    h.add("biceps_brachii_long_head", (long_, s))


def oblique_lower(h, s, pts=((1.25, 0.50), (0.5, 0.62), (-0.25, 0.74))):
    fr = h.fr(s)
    eo, io = cut(s.geom, fr, pts, "t")
    h.add("external_oblique", (eo, s))
    h.add("internal_oblique", (io, s))


def lateral_thigh(h, s, t=0.30):
    fr = h.fr(s, "pca")
    tfl, vl = cut(s.geom, fr, ((-0.4, t - 0.03), (1.4, t + 0.03)), "t")
    h.add("tensor_fasciae_latae", (tfl, s))
    h.add("vastus_lateralis", (vl, s))


def quad_centre(h, s, f=0.56):
    fr = h.fr(s, "pca")
    rf, vl = lsplit(s.geom, fr, f)
    h.add("rectus_femoris", (rf, s))
    h.add("vastus_lateralis", (vl, s))


def adductors_front(h, s, fg=0.30, tp=0.34):
    fr = h.fr(s, "pca")
    grac, rest = lsplit(s.geom, fr, fg)
    fr2 = h.fr(rest, "pca")
    pect, al = cut(rest, fr2, ((-0.4, tp + 0.10), (1.4, tp - 0.08)), "t")
    h.add("gracilis", (grac, s))
    h.add("pectineus", (pect, s))
    h.add("adductor_longus", (al, s))


def lower_back(h, s, fas=((-0.3, 0.42), (0.5, 0.60), (1.3, 0.80)), f=0.5):
    fr = h.fr(s)
    up, fascia = cut(s.geom, fr, fas, "t")
    fr2 = h.fr(up)
    lon, ilio = lsplit(up, fr2, f)
    h.add("thoracolumbar_fascia", (fascia, s))
    h.add("erector_spinae_longissimus", (lon, s))
    h.add("erector_spinae_iliocostalis", (ilio, s))


def ham_medial(h, s, f=0.42):
    fr = h.fr(s, "pca")
    sm, st = lsplit(s.geom, fr, f)
    h.add("semimembranosus", (sm, s))
    h.add("semitendinosus", (st, s))


def calf_lower(h, s, t=0.40):
    fr = h.fr(s, "pca")
    sol, ach = cut(s.geom, fr, ((-0.4, t), (0.5, t + 0.05), (1.4, t)), "t")
    h.add("soleus", (sol, s))
    h.add("achilles_tendon", (ach, s))


def ext_split(h, s, f=0.5):
    fr = h.fr(s, "pca")
    ecu, ed = lsplit(s.geom, fr, f)
    h.add("extensor_carpi_ulnaris", (ecu, s))
    h.add("extensor_digitorum", (ed, s))


# ---------------------------------------------------------------- male front
def male_front(h):
    S, add = h.S, h.add
    add("trapezius_upper", S(440, 284))
    add("sternocleidomastoid", h.drawn([(465, 225), (471, 218), (479, 221), (487, 244), (497, 272), (507, 298), (508, 311), (500, 317), (489, 313), (480, 292), (473, 262), (466, 241)]))
    add("deltoid_anterior", S(345, 365)); add("deltoid_lateral", S(314, 363))
    pec_cuts(h, S(436, 391), ((-0.2, 0.25), (0.35, 0.29), (0.75, 0.41), (1.2, 0.57)), ((-0.2, 0.83), (0.3, 0.81), (0.7, 0.68), (1.2, 0.48)))
    biceps_cuts(h, S(323, 473))
    add("triceps_brachii_lateral_head", S(286, 472))
    if h.img == "L":
        add("brachioradialis", S(256, 609)); add("wrist_flexor_group", S(291, 623))
        add("flexor_carpi_radialis", S(251, 670), S(223, 721)); add("pronator_teres", S(296, 555))
    else:
        add("brachioradialis", S(256, 609))
        s = S(291, 623); fr = h.fr(s, "pca")
        pt, fl = cut(s.geom, fr, ((-0.4, 0.07), (0.5, 0.135), (1.4, 0.16)), "t")
        add("pronator_teres", (pt, s)); add("wrist_flexor_group", (fl, s))
        add("flexor_carpi_radialis", S(251, 670), S(223, 721))
    add("rectus_abdominis_upper", S(475, 482)); add("rectus_abdominis_mid", S(476, 527), S(479, 579)); add("rectus_abdominis_lower", S(485, 669))
    add("serratus_anterior_1", S(422, 480)); add("serratus_anterior_2", S(420, 514)); add("serratus_anterior_3", S(419, 549))
    oblique_lower(h, S(428, 633))
    lateral_thigh(h, S(371, 818)); quad_centre(h, S(410, 852))
    add("sartorius", S(451, 793)); add("vastus_medialis", S(450, 918)); add("patella", S(410, 1038))
    adductors_front(h, S(487, 840))
    add("tibialis_anterior", S(384, 1167)); add("gastrocnemius_medial", S(430, 1120))
    if h.img == "L":
        add("peroneus_longus", S(355, 1102), S(364, 1228)); add("soleus", S(407, 1227))
    else:
        add("peroneus_longus", S(355, 1102), S(364, 1228))
        add("soleus", h.drawn([(418, 1190), (412, 1180), (406, 1186), (405, 1220), (405, 1260), (404, 1284), (410, 1291), (414, 1270), (418, 1230)]))


# ---------------------------------------------------------------- female front
def female_front(h):
    S, add = h.S, h.add
    add("trapezius_upper", S(453, 276))
    add("sternocleidomastoid", S(469, 289), S(483, 297),
        h.drawn([(463, 227), (469, 220), (477, 224), (482, 246), (486, 268), (479, 272), (471, 268), (466, 247)]))
    add("deltoid_anterior", S(371, 344)); add("deltoid_lateral", S(343, 343))
    pec_cuts(h, S(450, 375), ((-0.2, 0.25), (0.35, 0.28), (0.75, 0.36), (1.2, 0.45)), ((-0.2, 0.84), (0.3, 0.82), (0.62, 0.70), (1.2, 0.42)))
    biceps_cuts(h, S(352, 447))
    add("triceps_brachii_lateral_head", S(323, 450))
    add("brachioradialis", S(292, 597)); add("wrist_flexor_group", S(322, 607))
    add("flexor_carpi_radialis", S(291, 647)); add("pronator_teres", S(329, 529))
    add("rectus_abdominis_upper", S(480, 463)); add("rectus_abdominis_mid", S(481, 503), S(483, 553)); add("rectus_abdominis_lower", S(487, 643))
    add("serratus_anterior_1", S(439, 471)); add("serratus_anterior_2", S(440, 501)); add("serratus_anterior_3", S(441, 539))
    oblique_lower(h, S(436, 616))
    lateral_thigh(h, S(375, 795)); quad_centre(h, S(419, 835)); add("vastus_lateralis", S(389, 909, r=(626, 909)))
    add("sartorius", S(457, 787)); add("vastus_medialis", S(456, 910)); add("patella", S(413, 1038))
    adductors_front(h, S(485, 795))
    add("tibialis_anterior", S(394, 1155, r=(618, 1162))); add("gastrocnemius_medial", S(435, 1113, r=(578, 1114)))
    add("peroneus_longus", S(365, 1104, r=(649, 1102)), S(383, 1224, r=(629, 1225))); add("soleus", S(417, 1219, r=(595, 1221)))


# ---------------------------------------------------------------- male back
def male_back(h):
    S, add = h.S, h.add
    add("trapezius_upper", S(454, 284)); add("trapezius_mid", S(492, 377), S(485, 404)); add("trapezius_lower", S(474, 442))
    add("levator_scapulae", h.drawn([(458, 216), (464, 208), (478, 204), (491, 205), (495, 211), (482, 240), (468, 256), (456, 256)]))
    add("deltoid_posterior", S(345, 365)); add("deltoid_lateral", S(304, 368))
    add("infraspinatus", S(409, 364), S(423, 390))
    tmin, tmaj = S(414, 409), S(387, 418)
    fr = h.fr(unary_union([tmin.geom, tmaj.geom]))
    line = ((-0.05, 0.05), (0.20, 0.55), (0.50, 1.25))
    r1, a = cut(tmin.geom, fr, line, "a") if False else cut(tmin.geom, fr, line, "a")
    r2, b = cut(tmaj.geom, fr, line, "a")
    # medial side is the visible rhomboid sliver
    add("rhomboids", (r1, tmin), (r2, tmaj)); add("teres_minor", (a, tmin)); add("teres_major", (b, tmaj))
    add("triceps_brachii_lateral_head", S(297, 478)); add("triceps_brachii_medial_head", S(347, 484))
    s = S(315, 506); fr = h.fr(s, "pca")
    lh, anc = cut(s.geom, fr, ((-0.4, 0.80), (0.5, 0.83), (1.4, 0.80)), "t")
    add("triceps_brachii_long_head", (lh, s)); add("anconeus", (anc, s))
    add("brachioradialis", S(241, 609)); add("extensor_carpi_radialis", S(252, 635), S(247, 692), S(227, 739))
    ext_split(h, S(286, 643))
    add("latissimus_dorsi_upper", S(455, 513)); add("latissimus_dorsi_lower", S(439, 550))
    lower_back(h, S(485, 612))
    add("external_oblique", S(422, 590), S(400, 612))
    add("gluteus_medius", S(402, 689)); add("gluteus_maximus_upper", S(408, 724)); add("gluteus_maximus_lower", S(456, 752))
    add("vastus_lateralis", S(378, 833), S(356, 867)); add("adductor_magnus", S(495, 872))
    add("biceps_femoris_long_head", S(394, 929)); ham_medial(h, S(448, 937)); add("biceps_femoris_short_head", S(407, 1035))
    add("gastrocnemius_lateral", S(372, 1137)); add("gastrocnemius_medial", S(423, 1143))
    calf_lower(h, S(388, 1279)); add("soleus", S(344, 1144))


# ---------------------------------------------------------------- female back
def female_back(h):
    S, add = h.S, h.add
    add("trapezius_upper", S(481, 276))
    s = S(479, 398); fr = h.fr(s)
    up, rest = cut(s.geom, fr, ((-0.2, 0.30), (0.5, 0.27), (1.2, 0.20)), "t")
    mid, low = cut(rest, fr, ((-0.2, 0.60), (0.4, 0.50), (1.2, 0.30)), "t")
    add("trapezius_upper", (up, s)); add("trapezius_mid", (mid, s)); add("trapezius_lower", (low, s))
    add("levator_scapulae", h.drawn([(451, 240), (457, 229), (470, 223), (479, 223), (482, 230), (477, 262), (468, 284), (451, 286)]))
    add("deltoid_posterior", S(358, 380)); add("deltoid_lateral", S(324, 383))
    s = S(412, 400); fr = h.fr(s)
    rh, rest = cut(s.geom, fr, ((-0.25, 0.35), (0.15, 0.70), (0.50, 1.25)), "a")
    inf, tmin = cut(rest, fr, ((1.25, 0.46), (0.55, 0.66), (-0.25, 0.86)), "t")
    add("rhomboids", (rh, s)); add("infraspinatus", (inf, s)); add("teres_minor", (tmin, s))
    add("teres_major", S(392, 450))
    s = S(340, 497); fr = h.fr(s, "pca")
    up, anc = cut(s.geom, fr, ((-0.4, 0.86), (0.5, 0.88), (1.4, 0.86)), "t")
    lh, lat = lsplit(up, h.fr(up, "pca"), 0.52)
    add("anconeus", (anc, s)); add("triceps_brachii_long_head", (lh, s)); add("triceps_brachii_lateral_head", (lat, s), S(304, 503))
    add("triceps_brachii_medial_head", S(365, 523))
    s = S(266, 673); fr = h.fr(s, "pca")
    ecr, brd = cut(s.geom, fr, ((0.45, -0.25), (0.52, 0.25), (0.70, 0.55), (1.35, 0.74)), "a")
    add("brachioradialis", (brd, s)); add("extensor_carpi_radialis", (ecr, s), S(264, 722))
    ext_split(h, S(304, 666))
    s = S(461, 551); fr = h.fr(s)
    up, low = cut(s.geom, fr, ((1.3, -0.06), (0.74, 0.26), (0.46, 0.56), (0.22, 0.84), (0.02, 1.25)), "a")
    add("latissimus_dorsi_upper", (up, s)); add("latissimus_dorsi_lower", (low, s))
    s = S(471, 661); fr = h.fr(s)
    up, fascia = cut(s.geom, fr, ((-0.3, 0.60), (0.5, 0.62), (1.3, 0.70)), "t")
    lon, ilio = cut(up, fr, ((0.36, -0.3), (0.40, 0.4), (0.44, 1.3)), "a")
    add("thoracolumbar_fascia", (fascia, s)); add("erector_spinae_longissimus", (lon, s)); add("erector_spinae_iliocostalis", (ilio, s))
    add("external_oblique", S(419, 581))
    s = S(441, 769); fr = h.fr(s)
    rest, gmed = cut(s.geom, fr, ((-0.2, 0.36), (0.20, 0.20), (0.55, 0.16), (0.82, 0.27), (0.95, 0.50), (1.02, 0.80)), "a")
    lo, upp = cut(rest, fr, ((-0.2, 0.42), (0.22, 0.33), (0.50, 0.36), (0.72, 0.48), (0.86, 0.66), (0.93, 1.1)), "a")
    add("gluteus_medius", (gmed, s)); add("gluteus_maximus_upper", (upp, s)); add("gluteus_maximus_lower", (lo, s))
    add("vastus_lateralis", S(360, 900)); add("adductor_magnus", S(468, 954))
    add("biceps_femoris_long_head", S(387, 994)); ham_medial(h, S(433, 1006)); add("biceps_femoris_short_head", S(402, 1097))
    add("gastrocnemius_lateral", S(365, 1198)); add("gastrocnemius_medial", S(412, 1214))
    calf_lower(h, S(385, 1354)); add("soleus", S(361, 1368))


RECIPES = {"male-front": ("front", male_front), "male-back": ("back", male_back),
           "female-front": ("front", female_front), "female-back": ("back", female_back)}


def build(name):
    B = geo.Body(name)
    B.drawn = []
    if B.unpaired:
        print(f"  note {name}: unpaired sub-paths {B.unpaired}")
    view, fn = RECIPES[name]
    halves = both(B, view, fn)
    unused = [s.key for s in B.subs if not s.used]
    if unused:
        print(f"  !! {name}: unused sub-paths {unused}")
    regions = []
    for h in halves:
        for slug, pieces in h.regions.items():
            regions.append({"slug": f"{slug}_{h.side}", "base": slug, "parent": H[slug][0], "group": H[slug][1],
                            "side": h.side, "pieces": pieces})
    return B, regions


if __name__ == "__main__":
    import pickle
    out = {}
    for name in mm.BODIES:
        B, regions = build(name)
        print(name, len(regions), "regions")
        out[name] = (B, regions)
    pickle.dump(out, open("built.pkl", "wb"))
