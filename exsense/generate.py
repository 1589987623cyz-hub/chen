"""
EX-SENSE mask — single-source geometry generator (tiles only, no petals).

Units: millimetres. Three.js axes: +Y up, +Z toward viewer (mask faces +Z), +X viewer's right.
Origin = front-most point of the shell outer surface (between the eyes).

Surface parameter space ("UV", in mm):   U = a * theta ,  V = b * phi
All tile outlines are stored in UV. Map any UV point to 3D with
    shellAt(U/a, V/b) + shellNormal(U/a, V/b) * offset

Run:  python generate.py      -> params.json, tiles.json, drawings/*.svg
Needs: numpy, scipy, scikit-image
"""
import json, math, os
import numpy as np
from scipy import ndimage
from skimage import measure

# ------------------------------------------------------------------ 1. PARAMETERS
P = {
    "units": "mm",
    "coordinate_system": "Three.js: +Y up, +Z toward viewer, +X viewer's right. Origin = front-most shell point.",
    "uv_definition": "U = a_halfWidth * theta(rad), V = b_halfHeight * phi(rad)",
    "shell": {
        "a_halfWidth": 78.0, "b_halfHeight": 105.0, "c_depth": 88.0,
        "thetaMax_deg": 80.0, "phiMin_deg": -62.0, "phiMax_deg": 70.0,
        "chinTaper": 0.25, "chinTaperExp": 1.4,
        "thickness": 2.0,                       # grows inward (-normal)
        # side profile of the centre line: nearly flat like a face, not an egg
        "foreheadBack": 20.0, "profileTopY": 97.0,      # surface sits this far back at y = profileTopY
        "chinBack": 5.0, "profileBottomY": 92.0,        # and this far back at y = -profileBottomY
        "profileExp": 2.2,
    },
    # Reference face used only to check the fit. Typical adult proportions, estimated, not a scan.
    # Each row is [y, centre-line z, half width], in mask coordinates with z = 0 at the brow.
    "fitReference": {
        "browOffset": -12.0,                    # brow sits this far behind the shell's front point
        "earDepth": 95.0,                       # face curves back this far between centre and half width
        "minClearance": 3.0,                    # shell inner surface must clear the face by this much
        "noseHalfWidth": 19.0, "noseY": -36.0, "noseMinOpeningClearance": 0.5,
        "rows": [
            [97, -24, 62], [82, -12, 65], [60, -5, 68], [30, -1, 70], [20, 0, 71], [12, -2, 71], [6, -4, 71],
            [-5, -3, 71], [-17, -2, 70], [-28, -1, 68], [-36, 0, 66], [-48, 6, 62], [-58, 3, 59], [-66, 5, 56],
            [-78, -3, 50], [-92, -1, 42], [-108, -12, 25],
        ],
        # The nose is a separate ridge on the centre line: [y, height above the face], and its spread.
        "noseRows": [[10, 0], [-5, 5], [-17, 10], [-28, 17], [-36, 5], [-42, 0]],
        "noseSigma": 11.0,
    },
    "trim": {                                   # face outline = superellipse in UV
        "centerV": 6.0, "halfU": 104.0, "halfV": 118.0, "exponent": 2.5,
    },
    "openings": {
        "eyes": {"cx": 33.0, "cy": 12.0, "rx": 20.0, "ry": 12.5, "rot_deg": 8.0},
        "noseMouth": {"apex": [0.0, 8.0], "baseY": -70.0, "baseHalfWidth": 36.0, "cornerRadius": 8.0},
    },
    "tiles": {
        "latticeDiagU": 24.0,                   # diamond cell width (UV mm)
        "latticeDiagV": 28.0,                   # diamond cell height (UV mm)
        "gap": 1.8,                             # gap between neighbouring tiles
        "centreSeam": True,                     # split tiles on the vertical centre line
        "edgeMargin": 5.0,                      # tiles stop this far inside the trim
        "openingMargin": 3.0,                   # tiles stop this far from eye / nose openings
        "cornerRadius": 2.2,
        "minAreaFrac": 0.22,                    # drop slivers smaller than this * full cell area
        "thickness": 3.0,
        "undersideOffset": 2.5,                 # rest gap above shell (actuator travel space)
        "chamfer": 0.8,                         # top edge bevel
        "travelIn": 1.5,                        # SPACE state: tile pushed inward
        "outlineStep": 1.2,                     # resample spacing of tile outlines
        "raster": 0.2,                          # contour raster resolution
        "faceMeshSpacing": 3.0,                 # interior vertex spacing of the top/bottom face meshes (UV mm)
    },
    "pins": {"radius": 1.5, "height": 4.2, "baseOffset": 0.0, "minClearance": 0.2},   # visible actuator pins at lattice vertices
    # Each form below follows a function. Sensor spots are lattice positions [i, j]: (U, V) = (i * diagU / 2, j * diagV / 2).
    "sensors": {
        "holeRadius": 4.5, "collarRadius": 6.5, "lensRadius": 4.8,   # hole in the shell, metal collar, lens
        "backOffset": -2.2, "collarTop": 3.4, "lensTop": 4.0,        # along the surface normal
        "tileClearance": 1.2,                                        # tiles stop this far from a collar
        # one distance sensor per feedback sector, so each direction you feel has a window facing it
        "space": {"top": [0, 6], "upperRight": [6, 4], "right": [7, 1], "lowerRight": [6, -4], "bottom": [0, -6.5],
                  "lowerLeft": [-6, -4], "left": [-7, 1], "upperLeft": [-6, 4]},
        "uv": {"sky": [0, 8]},                                       # top of the forehead, tilted toward the sky
        "air": {"inlet": [5, -1], "outlet": [-5, -1]},               # particle sensor pulls air across the face
    },
    "straps": {
        "radius": 3.5, "tileClearance": 1.2,
        "slots": [[92.0, 24.0, 90.0, 44.0], [92.0, -24.0, 90.0, -42.0]],   # [U0, V0, U1, V1], mirrored to the left side
    },
    # Skin side: a stem from each tile passes through the shell and ends in a soft pad just off the skin,
    # so a pushed tile is felt. Its length comes from the gap to the reference face at that tile.
    "contacts": {
        "stemRadius": 1.2, "stemHoleRadius": 1.8, "padRadius": 3.5, "padHeight": 2.0,
        "thermalPadRadius": 7.0, "thermalZones": ["cheek_L", "cheek_R"],   # warm and cool cues need more skin
        "tipGap": 0.5,                          # pad sits this far off the skin at rest
        "maxReach": 18.0,                       # a tile further than this from the face gets no contact
        "openingMargin": 1.0,                   # pads stay this far outside the eye and nose openings
        "minPadGap": 1.0,                       # pads keep at least this far apart
        "minPerSector": 3,
    },
}
S, T, O, TL = P["shell"], P["trim"], P["openings"], P["tiles"]
SE, ST, CT = P["sensors"], P["straps"], P["contacts"]
R = math.radians
A, B, C = S["a_halfWidth"], S["b_halfHeight"], S["c_depth"]
U_MAX = A * R(S["thetaMax_deg"]); V_MIN = B * R(S["phiMin_deg"]); V_MAX = B * R(S["phiMax_deg"])

# ------------------------------------------------------------------ 2. SHELL
def taper(phi):
    return 1.0 - S["chinTaper"] * (max(0.0, -math.sin(phi)) ** S["chinTaperExp"])

def profile(phi):
    """Centre-line depth: how far the surface sits behind the front point at this height."""
    y = B * math.sin(phi)
    if y >= 0:
        return -S["foreheadBack"] * (y / S["profileTopY"]) ** S["profileExp"]
    return -S["chinBack"] * (-y / S["profileBottomY"]) ** S["profileExp"]

def shell(theta, phi):
    k = taper(phi)
    return (A * k * math.sin(theta) * math.cos(phi), B * math.sin(phi),
            C * (math.cos(theta) - 1.0) * math.cos(phi) + profile(phi))

def normal_tp(theta, phi):
    e = 1e-4; p0 = shell(theta, phi); pt = shell(theta + e, phi); pp = shell(theta, phi + e)
    du = [pt[i] - p0[i] for i in range(3)]; dv = [pp[i] - p0[i] for i in range(3)]
    n = [dv[1]*du[2]-dv[2]*du[1], dv[2]*du[0]-dv[0]*du[2], dv[0]*du[1]-dv[1]*du[0]]
    l = math.sqrt(sum(c*c for c in n)); n = [c/l for c in n]
    return [-c for c in n] if n[2] < 0 else n

def uv_to_3d(u, v, off=0.0):
    th, ph = u / A, v / B; p = shell(th, ph); n = normal_tp(th, ph)
    return [p[i] + n[i] * off for i in range(3)]

def uv_to_front(u, v):
    p = shell(u / A, v / B); return (p[0], p[1])

def uv_to_front_np(U, V):
    th, ph = U / A, V / B
    k = 1.0 - S["chinTaper"] * np.maximum(0.0, -np.sin(ph)) ** S["chinTaperExp"]
    return A * k * np.sin(th) * np.cos(ph), B * np.sin(ph)

# ------------------------------------------------------------------ 3. SIGNED DISTANCE FIELDS (negative = inside)
def sdf_trim(U, V):
    n = T["exponent"]
    r = ((np.abs(U) / T["halfU"]) ** n + (np.abs(V - T["centerV"]) / T["halfV"]) ** n) ** (1.0 / n)
    return (r - 1.0) * min(T["halfU"], T["halfV"])
    # also limited by the shell parameter rectangle:

def sdf_shell_rect(U, V):
    return np.maximum.reduce([np.abs(U) - U_MAX, V_MIN - V, V - V_MAX])

def sdf_eye(X, Y, side):
    e = O["eyes"]; cx = side * e["cx"]; rot = R(-side * e["rot_deg"])
    dx, dy = X - cx, Y - e["cy"]
    lx = dx * math.cos(rot) + dy * math.sin(rot); ly = -dx * math.sin(rot) + dy * math.cos(rot)
    return (np.sqrt((lx / e["rx"]) ** 2 + (ly / e["ry"]) ** 2) - 1.0) * min(e["rx"], e["ry"])

def tri_rounded_vertices():
    """inner triangle whose r-offset is the rounded nose/mouth opening (same outer bbox as the sharp one)"""
    m = O["noseMouth"]; r = m["cornerRadius"]
    V3 = [np.array(m["apex"], float), np.array([-m["baseHalfWidth"], m["baseY"]]), np.array([m["baseHalfWidth"], m["baseY"]])]
    # move each edge inward by r -> intersect
    lines = []
    for i in range(3):
        a, b = V3[i], V3[(i + 1) % 3]; d = b - a; n = np.array([d[1], -d[0]]) / np.linalg.norm(d)
        cen = sum(V3) / 3
        if np.dot(cen - a, n) < 0: n = -n                  # inward normal
        lines.append((a + n * r, d))
    pts = []
    for i in range(3):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        cr = lambda a, b: a[0]*b[1] - a[1]*b[0]
        t = cr(p2 - p1, d2) / cr(d1, d2); pts.append(p1 + d1 * t)
    return pts

TRI_IN = tri_rounded_vertices()

def sdf_tri(X, Y):
    m = O["noseMouth"]; r = m["cornerRadius"]
    # exact SDF of convex polygon (inner triangle) then subtract r -> rounded triangle
    P_ = np.stack([X, Y], -1); d_out = None; inside = np.ones(X.shape, bool); dmin = np.full(X.shape, np.inf)
    cen = sum(TRI_IN) / 3
    for i in range(3):
        a, b = TRI_IN[i], TRI_IN[(i + 1) % 3]; ab = b - a
        t = np.clip(((P_ - a) @ ab) / (ab @ ab), 0, 1)
        proj = a + t[..., None] * ab; dist = np.linalg.norm(P_ - proj, axis=-1)
        dmin = np.minimum(dmin, dist)
        n = np.array([ab[1], -ab[0]]); n = n if np.dot(cen - a, n) > 0 else -n
        inside &= ((P_ - a) @ n) >= 0
    return np.where(inside, -dmin, dmin) - r

def sdf_openings_front(X, Y):
    return np.minimum.reduce([sdf_eye(X, Y, -1), sdf_eye(X, Y, 1), sdf_tri(X, Y)])

def sensor_spots():
    cell = lambda ij: (ij[0] * TL["latticeDiagU"] / 2, ij[1] * TL["latticeDiagV"] / 2)
    return [{"kind": kind, "name": name, "uv": cell(ij)} for kind in ("space", "uv", "air") for name, ij in SE[kind].items()]

def strap_slots():
    return [s for u0, v0, u1, v1 in ST["slots"] for s in ([u0, v0, u1, v1], [-u0, v0, -u1, v1])]

SPOTS, SLOTS = sensor_spots(), strap_slots()

def sdf_segment(U, V, u0, v0, u1, v1):
    du, dv = u1 - u0, v1 - v0; l2 = du * du + dv * dv
    t = np.clip(((U - u0) * du + (V - v0) * dv) / l2, 0, 1) if l2 else 0.0
    return np.hypot(U - (u0 + t * du), V - (v0 + t * dv))

def sdf_features(U, V):
    """Keep-out for tiles and pins, in UV mm: sensor collars and strap slots."""
    near = [sdf_segment(U, V, *s["uv"], *s["uv"]) - SE["collarRadius"] - SE["tileClearance"] for s in SPOTS]
    near += [sdf_segment(U, V, *slot) - ST["radius"] - ST["tileClearance"] for slot in SLOTS]
    return np.minimum.reduce(near)

def sdf_diamond(U, V, cu, cv):
    hu, hv = TL["latticeDiagU"] / 2, TL["latticeDiagV"] / 2
    return (np.abs(U - cu) / hu + np.abs(V - cv) / hv - 1.0) * (hu * hv / math.hypot(hu, hv))

# ------------------------------------------------------------------ 4. CONTOUR HELPERS
def resample_closed(pts, step):
    pts = np.asarray(pts); seg = np.linalg.norm(np.diff(np.vstack([pts, pts[:1]]), axis=0), axis=1)
    L = seg.sum(); n = max(12, int(round(L / step))); s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, L, n, endpoint=False)
    loop = np.vstack([pts, pts[:1]])
    return np.stack([np.interp(t, s, loop[:, 0]), np.interp(t, s, loop[:, 1])], -1)

def area(pts):
    x, y = pts[:, 0], pts[:, 1]; return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))

def inset_ring(pts, d):
    """per-vertex miter offset inward by d (pts CCW, smooth)"""
    prev, nxt = np.roll(pts, 1, 0), np.roll(pts, -1, 0)
    t = nxt - prev; t /= np.linalg.norm(t, axis=1, keepdims=True)
    n_in = np.stack([-t[:, 1], t[:, 0]], -1)              # left normal of CCW = inward
    return pts + n_in * d


def _ear_clip(P_):
    n = len(P_); idx = list(range(n)); tris = []
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    def inside(p, a, b, c):
        d1, d2, d3 = cross(a, b, p), cross(b, c, p), cross(c, a, p)
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
    guard = 0
    while len(idx) > 3 and guard < 100000:
        guard += 1; best = None
        for k in range(len(idx)):
            i0, i1, i2 = idx[k-1], idx[k], idx[(k+1) % len(idx)]
            if cross(P_[i0], P_[i1], P_[i2]) <= 1e-12: continue
            if any(inside(P_[j], P_[i0], P_[i1], P_[i2]) for j in idx if j not in (i0, i1, i2)): continue
            # prefer the fattest ear
            q = cross(P_[i0], P_[i1], P_[i2]) / (np.sum((P_[i0]-P_[i2])**2) + 1e-9)
            if best is None or q > best[0]: best = (q, k, (i0, i1, i2))
        if best is None: raise RuntimeError("ear clipping failed")
        tris.append(best[2]); idx.pop(best[1])
    tris.append(tuple(idx)); return tris

def face_mesh(ring, spacing):
    """Clean disc mesh of a CCW ring: ear clipping -> conforming longest-edge bisection -> Delaunay edge flips.
    Boundary edges are never split, so the first len(ring) vertices are exactly the ring (walls attach cleanly)."""
    pts = [np.asarray(p, float) for p in ring]; n0 = len(pts)
    tris = [list(t) for t in _ear_clip(np.asarray(ring, float))]
    L = lambda i, j: float(np.linalg.norm(pts[i] - pts[j]))
    def edge_map():
        m = {}
        for ti, t in enumerate(tris):
            for k in range(3):
                e = frozenset((t[k], t[(k+1) % 3])); m.setdefault(e, []).append(ti)
        return m
    def flips():
        for _ in range(20):
            m = edge_map(); changed = False
            for e, ts in m.items():
                if len(ts) != 2: continue
                i, j = tuple(e); t1, t2 = tris[ts[0]], tris[ts[1]]
                a = [v for v in t1 if v not in e][0]; b = [v for v in t2 if v not in e][0]
                def ang(o, p, q):
                    u, w = pts[p]-pts[o], pts[q]-pts[o]; return math.acos(max(-1, min(1, u @ w / (np.linalg.norm(u)*np.linalg.norm(w)+1e-12))))
                if ang(a, i, j) + ang(b, i, j) <= math.pi + 1e-9: continue
                def cr(o, p, q): return (pts[p][0]-pts[o][0])*(pts[q][1]-pts[o][1]) - (pts[p][1]-pts[o][1])*(pts[q][0]-pts[o][0])
                n1 = [a, b, i] if cr(a, b, i) > 0 else [a, i, b]
                n2 = [a, b, j] if cr(a, b, j) > 0 else [a, j, b]
                if cr(*n1) <= 1e-9 or cr(*n2) <= 1e-9: continue
                tris[ts[0]], tris[ts[1]] = n1, n2; changed = True; break
            if not changed: return
    flips()
    for _ in range(4000):
        m = edge_map(); longest = None
        for e, ts in m.items():
            if len(ts) == 2:
                l = L(*tuple(e))
                if l > spacing * 1.25 and (longest is None or l > longest[0]): longest = (l, e, ts)
        if longest is None: break
        _, e, ts = longest; i, j = tuple(e)
        pts.append((pts[i] + pts[j]) / 2); mi = len(pts) - 1
        for ti in ts:
            t = tris[ti]; o = [v for v in t if v not in e][0]
            k = t.index(o); a_, b_ = t[(k+1) % 3], t[(k+2) % 3]      # keep orientation o -> a_ -> b_
            tris[ti] = [o, a_, mi]; tris.append([o, mi, b_])
        if _ % 25 == 24: flips()
    flips()
    P_ = np.asarray(pts); T_ = np.asarray(tris, int)
    a, b, c = P_[T_[:, 0]], P_[T_[:, 1]], P_[T_[:, 2]]
    cr = (b[:, 0]-a[:, 0])*(c[:, 1]-a[:, 1]) - (b[:, 1]-a[:, 1])*(c[:, 0]-a[:, 0])
    assert (cr > 0).all(), "face mesh has non-CCW triangle"
    assert abs(0.5 * cr.sum() - abs(area(np.asarray(ring)))) < 1e-6 * abs(area(np.asarray(ring))) + 1e-6, "face area mismatch"
    return P_, T_

# ------------------------------------------------------------------ 5. TILES
def build_tiles():
    du, dv, gap, r = TL["latticeDiagU"], TL["latticeDiagV"], TL["gap"], TL["cornerRadius"]
    res = TL["raster"]; full_area = du * dv / 2
    tiles, cells = [], []
    # lattice: diamond centres at (i*du/2, j*dv/2) with i+j odd  -> vertices lie on U = 0 (centre seam)
    imax = int(U_MAX / (du / 2)) + 2; jmin = int(V_MIN / (dv / 2)) - 2; jmax = int(V_MAX / (dv / 2)) + 2
    for j in range(jmin, jmax + 1):
        for i in range(-imax, imax + 1):
            if (i + j) % 2 == 0: continue
            cu, cv = i * du / 2, j * dv / 2
            pad = 2.0
            us = np.arange(cu - du / 2 - pad, cu + du / 2 + pad, res); vs = np.arange(cv - dv / 2 - pad, cv + dv / 2 + pad, res)
            Ug, Vg = np.meshgrid(us, vs)
            X, Y = uv_to_front_np(Ug, Vg)
            F = np.maximum.reduce([
                sdf_diamond(Ug, Vg, cu, cv) + gap / 2,
                sdf_trim(Ug, Vg) + TL["edgeMargin"],
                sdf_shell_rect(Ug, Vg) + TL["edgeMargin"],
                TL["openingMargin"] - sdf_openings_front(X, Y),
                -sdf_features(Ug, Vg),
                (gap / 2 - np.abs(Ug)) if TL["centreSeam"] else np.full(Ug.shape, -1.0),
            ])
            mask = F < 0
            if mask.sum() * res * res < TL["minAreaFrac"] * full_area: continue
            # morphological opening by r -> rounded convex corners
            d_in = ndimage.distance_transform_edt(mask) * res
            core = d_in > r
            if not core.any(): continue
            d_out = ndimage.distance_transform_edt(~core) * res
            field = np.where(core, -ndimage.distance_transform_edt(core) * res, d_out) - r
            lab, nlab = ndimage.label(field < 0)
            for k in range(1, nlab + 1):
                piece = np.where(lab == k, field, np.abs(field) + res)
                cs = measure.find_contours(piece, 0.0)
                if not cs: continue
                c = max(cs, key=len)
                pts = np.stack([us[0] + c[:, 1] * res, vs[0] + c[:, 0] * res], -1)
                if area(pts) < 0: pts = pts[::-1]
                if abs(area(pts)) < TL["minAreaFrac"] * full_area: continue
                for _ in range(3): pts = 0.5 * pts + 0.25 * (np.roll(pts, 1, 0) + np.roll(pts, -1, 0))   # remove raster wiggle
                pts = resample_closed(pts, TL["outlineStep"])
                if area(pts) < 0: pts = pts[::-1]
                top = inset_ring(pts, TL["chamfer"])
                cen = pts.mean(0)
                tiles.append({"cell": [i, j], "piece": k, "outlineUV": pts, "topUV": top, "centroidUV": cen,
                              "areaUV": abs(area(pts))})
            cells.append((cu, cv))
    # IDs: lattice row from top, then left -> right
    tiles.sort(key=lambda t: (-t["cell"][1], t["centroidUV"][0]))
    rows = sorted({t["cell"][1] for t in tiles}, reverse=True)
    out, col = [], {}
    for t in tiles:
        rI = rows.index(t["cell"][1]); cI = col.get(rI, 0); col[rI] = cI + 1
        cu, cv = (float(x) for x in t["centroidUV"]); fx, fy = uv_to_front(cu, cv)
        out.append({
            "id": f"T{rI:02d}-{cI:02d}", "row": rI, "col": cI, "cell": t["cell"],
            "centroidUV": [round(cu, 3), round(cv, 3)], "centroid2D": [round(fx, 3), round(fy, 3)],
            "centroid3D": [round(x, 3) for x in uv_to_3d(cu, cv, TL["undersideOffset"] + TL["thickness"])],
            "normal": [round(x, 5) for x in normal_tp(cu / A, cv / B)],
            "areaUV": round(float(t["areaUV"]), 2),
            "sector": sector_of(fx, fy), "zone": zone_of(fx, fy),
            "outlineUV": [[round(float(a), 3), round(float(b), 3)] for a, b in t["outlineUV"]],
            "topUV": [[round(float(a), 3), round(float(b), 3)] for a, b in t["topUV"]],
            "topFace": mesh_json(t["topUV"]), "bottomFace": mesh_json(t["outlineUV"]),
        })
    return out

def mesh_json(ring):
    pts, tri = face_mesh(ring, TL["faceMeshSpacing"])
    return {"uv": [[round(float(a), 3), round(float(b), 3)] for a, b in pts], "tris": tri.astype(int).tolist()}

def sector_of(x, y):
    a = math.degrees(math.atan2(y - O["eyes"]["cy"], x)) % 360
    names = ["right", "upperRight", "top", "upperLeft", "left", "lowerLeft", "bottom", "lowerRight"]
    return names[int(((a + 22.5) % 360) // 45)]

def zone_of(x, y):
    if y > O["eyes"]["cy"] + O["eyes"]["ry"] + 6: return "forehead"
    if y < -72: return "chin"
    if abs(x) > 36 and y < O["eyes"]["cy"] - 4: return "cheek_R" if x > 0 else "cheek_L"
    if abs(x) > 50: return "temple_R" if x > 0 else "temple_L"
    return "centre"

# ------------------------------------------------------------------ 6. PINS (visible at lattice vertices)
def build_pins(tiles):
    du, dv = TL["latticeDiagU"], TL["latticeDiagV"]; pins = []
    for j in range(int(V_MIN / (dv / 2)) - 2, int(V_MAX / (dv / 2)) + 3):
        for i in range(-int(U_MAX / (du / 2)) - 2, int(U_MAX / (du / 2)) + 3):
            if (i + j) % 2: continue                          # lattice vertices = even (i+j)
            u, v = i * du / 2, j * dv / 2
            Ug, Vg = np.array([[u]]), np.array([[v]]); X, Y = uv_to_front_np(Ug, Vg)
            if sdf_trim(Ug, Vg)[0, 0] > -TL["edgeMargin"] - 2 or sdf_shell_rect(Ug, Vg)[0, 0] > -2: continue
            if sdf_openings_front(X, Y)[0, 0] < TL["openingMargin"] + 1: continue
            if sdf_features(Ug, Vg)[0, 0] < P["pins"]["radius"]: continue
            # keep only where at least 2 tiles meet around it
            near = sum(1 for t in tiles if abs(t["centroidUV"][0] - u) < du * 0.6 and abs(t["centroidUV"][1] - v) < dv * 0.6)
            if near < 2: continue
            # clearance: pin must not touch any tile outline (UV distance)
            pc = np.array([u, v]); clear = min(float(np.min(np.linalg.norm(np.array(t["outlineUV"]) - pc, axis=1)))
                                              for t in tiles if abs(t["centroidUV"][0] - u) < du and abs(t["centroidUV"][1] - v) < dv)
            if clear < P["pins"]["radius"] + P["pins"]["minClearance"]: continue
            pins.append({"clearance": round(clear, 3), "id": f"N{len(pins):03d}", "uv": [round(u, 3), round(v, 3)], "p2D": [round(float(X[0,0]), 3), round(float(Y[0,0]), 3)],
                         "base3D": [round(x, 3) for x in uv_to_3d(u, v, P["pins"]["baseOffset"])],
                         "normal": [round(x, 5) for x in normal_tp(u / A, v / B)]})
    return pins

# ------------------------------------------------------------------ 7. OUTLINES FOR SHELL ALPHA MASK (UV)
def front_to_uv(x, y):
    ph = math.asin(max(-1, min(1, y / B))); den = A * taper(ph) * math.cos(ph)
    th = math.asin(max(-1, min(1, x / den))); return (A * th, B * ph)

def eye_poly(side, n=96):
    e = O["eyes"]; cx = side * e["cx"]; rot = R(-side * e["rot_deg"]); pts = []
    for i in range(n):
        t = 2 * math.pi * i / n; px, py = e["rx"] * math.cos(t), e["ry"] * math.sin(t)
        pts.append((cx + px * math.cos(rot) - py * math.sin(rot), e["cy"] + px * math.sin(rot) + py * math.cos(rot)))
    return pts

def tri_poly(n_arc=12):
    r = O["noseMouth"]["cornerRadius"]; V3 = TRI_IN; cen = sum(V3) / 3; pts = []
    for i in range(3):
        a, b, c = V3[i - 1], V3[i], V3[(i + 1) % 3]
        def out_n(p, q):
            d = q - p; n = np.array([d[1], -d[0]]) / np.linalg.norm(d); return n if np.dot(cen - p, n) < 0 else -n
        n1, n2 = out_n(a, b), out_n(b, c); a1, a2 = math.atan2(n1[1], n1[0]), math.atan2(n2[1], n2[0])
        if a2 < a1: a2 += 2 * math.pi
        if a2 - a1 > math.pi: a1, a2 = a2, a1 + 2 * math.pi
        for k in range(n_arc + 1):
            t = a1 + (a2 - a1) * k / n_arc; pts.append((b[0] + r * math.cos(t), b[1] + r * math.sin(t)))
    return pts

def trim_poly_uv(n=240):
    e = T["exponent"]; pts = []
    for i in range(n):
        t = 2 * math.pi * i / n; c, s = math.cos(t), math.sin(t)
        u = T["halfU"] * np.sign(c) * abs(c) ** (2 / e); v = T["centerV"] + T["halfV"] * np.sign(s) * abs(s) ** (2 / e)
        pts.append((float(np.clip(u, -U_MAX, U_MAX)), float(np.clip(v, V_MIN, V_MAX))))
    return pts

# ------------------------------------------------------------------ 8. FIT CHECK AGAINST THE REFERENCE FACE
def reference_face():
    F = P["fitReference"]; rows = np.array(sorted(F["rows"]), float); nose = np.array(sorted(F["noseRows"]), float)
    def z_at(x, y):
        half = np.interp(y, rows[:, 0], rows[:, 2]); mid = np.interp(y, rows[:, 0], rows[:, 1])
        r = min(abs(x) / half, 1.0)
        ridge = np.interp(y, nose[:, 0], nose[:, 1], left=0.0, right=0.0) * math.exp(-((x / F["noseSigma"]) ** 2))
        return F["browOffset"] + mid + ridge - F["earDepth"] * (1.0 - math.sqrt(1.0 - r * r))
    return z_at

def fit_report():
    """Smallest gap between the shell's inner surface and the face, over the solid part of the shell."""
    F = P["fitReference"]; z_at = reference_face(); best = None; band = {}
    for u in np.arange(-U_MAX, U_MAX, 4.0):
        for v in np.arange(V_MIN, V_MAX, 3.0):
            Ug, Vg = np.array([[u]]), np.array([[v]]); X, Y = uv_to_front_np(Ug, Vg)
            if sdf_trim(Ug, Vg)[0, 0] > 0 or sdf_openings_front(X, Y)[0, 0] < 0: continue
            p = uv_to_3d(float(u), float(v), -S["thickness"])
            gap = p[2] - z_at(p[0], p[1])
            if best is None or gap < best[0]: best = (gap, p)
            key = "forehead" if p[1] > 30 else "bridge" if p[1] > -20 and abs(p[0]) < 12 else "chin" if p[1] < -70 else "cheek"
            band[key] = min(band.get(key, 1e9), gap)
    top = [p for p in openings_front_points("noseMouth")]
    half_at_nose = min(abs(x) for x, y in top if abs(y - F["noseY"]) < 2.0)
    nose_gap = half_at_nose - F["noseHalfWidth"]
    assert best[0] >= F["minClearance"], f"shell cuts into the reference face: gap {best[0]:.1f} at {best[1]}"
    assert nose_gap >= F["noseMinOpeningClearance"], f"nose opening too narrow: {nose_gap:.1f}"
    return {"minGap": round(best[0], 2), "byRegion": {k: round(v, 2) for k, v in band.items()},
            "noseOpeningHalfWidth": round(half_at_nose, 2), "noseSideClearance": round(nose_gap, 2)}

def openings_front_points(name):
    pts = np.array(tri_poly()); out = []
    for a, b in zip(pts, np.roll(pts, -1, axis=0)):
        for t in np.linspace(0, 1, 12, endpoint=False): out.append(tuple(a + (b - a) * t))
    return out

# ------------------------------------------------------------------ 9. SENSORS, CONTACTS
def build_sensors():
    out = []
    for s in SPOTS:
        u, v = s["uv"]; n = normal_tp(u / A, v / B)
        out.append({"id": f"{s['kind']}-{s['name']}", "kind": s["kind"], "name": s["name"], "uv": [round(u, 3), round(v, 3)],
                    "p2D": [round(x, 3) for x in uv_to_front(u, v)], "base3D": [round(x, 3) for x in uv_to_3d(u, v, 0.0)],
                    "normal": [round(x, 5) for x in n], "facingDeg": round(math.degrees(math.acos(n[2])), 1)})
    return out

def tile_anchor(outline):
    """Deepest point inside a tile, so the stem stays clear of its edges even on clipped tiles."""
    lo, hi = np.floor(outline.min(0) * 2) / 2, np.ceil(outline.max(0) * 2) / 2      # grid on 0.5 multiples, so it mirrors
    grid = np.stack(np.meshgrid(np.arange(lo[0], hi[0], 0.5), np.arange(lo[1], hi[1], 0.5)), -1).reshape(-1, 2)
    grid = grid[measure.points_in_poly(grid, outline)]
    depth = np.linalg.norm(grid[:, None] - outline[None], axis=2).min(1)
    deep = grid[depth > depth.max() - 0.5]                                           # diamonds have a flat ridge of equal depth
    return deep[int(np.linalg.norm(deep - outline.mean(0), axis=1).argmin())]

def build_contacts(tiles):
    z_at = reference_face(); out = []
    for t in tiles:
        u, v = (float(x) for x in tile_anchor(np.array(t["outlineUV"])))
        n = np.array(normal_tp(u / A, v / B)); start = np.array(uv_to_3d(u, v, -S["thickness"]))
        reach = next((d for d in np.arange(0.0, CT["maxReach"], 0.05)
                      if (start - n * d)[2] <= z_at(*(start - n * d)[:2])), None)
        if reach is None or reach < CT["padHeight"] + CT["tipGap"]: continue
        tip = start - n * (reach - CT["tipGap"])
        room = sdf_openings_front(np.array([[tip[0]]]), np.array([[tip[1]]]))[0, 0] - CT["openingMargin"]
        thermal = t["zone"] in CT["thermalZones"] and room >= CT["thermalPadRadius"]
        if room < CT["padRadius"]: continue
        out.append({"id": "C" + t["id"][1:], "tile": t["id"], "uv": [round(u, 3), round(v, 3)], "sector": t["sector"], "zone": t["zone"],
                    "base3D": [round(x, 3) for x in uv_to_3d(u, v, TL["undersideOffset"])], "axis": [round(float(x), 5) for x in -n],
                    "length": round(TL["undersideOffset"] + S["thickness"] + float(reach) - CT["tipGap"], 2),
                    "padRadius": CT["thermalPadRadius"] if thermal else CT["padRadius"], "thermal": bool(thermal), "reach": round(float(reach), 2),
                    "tileArea": t["areaUV"]})
    return settle_pads(out)

def contact_tip(c):
    return np.array(c["base3D"]) + np.array(c["axis"]) * c["length"]

def settle_pads(contacts):
    """Two pads too close: a wide pad shrinks first, then the one on the smaller tile goes."""
    while True:
        clash = next(((a, b) for i, a in enumerate(contacts) for b in contacts[i + 1:]
                      if np.linalg.norm(contact_tip(a) - contact_tip(b)) - a["padRadius"] - b["padRadius"] < CT["minPadGap"]), None)
        if clash is None: break
        wide = [c for c in clash if c["thermal"]]
        chosen = min(wide or clash, key=lambda c: c["tileArea"])
        pair = [c for c in contacts if abs(c["uv"][0] + chosen["uv"][0]) < 1.0 and abs(c["uv"][1] - chosen["uv"][1]) < 1.0]
        for c in pair + [chosen]:                    # keep left and right the same
            if wide: c["thermal"] = False; c["padRadius"] = CT["padRadius"]
            elif c in contacts: contacts.remove(c)
    for c in contacts: del c["tileArea"]
    return contacts

def contact_report(contacts):
    room = min(float(np.linalg.norm(contact_tip(c) - contact_tip(d))) - c["padRadius"] - d["padRadius"]
               for i, c in enumerate(contacts) for d in contacts[i + 1:])
    by = {}
    for c in contacts: by[c["sector"]] = by.get(c["sector"], 0) + 1
    names = ["right", "upperRight", "top", "upperLeft", "left", "lowerLeft", "bottom", "lowerRight"]
    assert all(by.get(s, 0) >= CT["minPerSector"] for s in names), f"sector without enough contacts: {by}"
    assert TL["travelIn"] > CT["tipGap"], "a pushed tile would not reach the skin"
    return {"bySector": {s: by[s] for s in names}, "thermalPads": sum(c["thermal"] for c in contacts),
            "smallestPadGap": round(room, 2), "skinPress": round(TL["travelIn"] - CT["tipGap"], 2),
            "lengthRange": [min(c["length"] for c in contacts), max(c["length"] for c in contacts)]}

# ------------------------------------------------------------------ main
if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    tiles = build_tiles(); pins = build_pins(tiles); sensors = build_sensors(); contacts = build_contacts(tiles)
    trim_uv = trim_poly_uv(); trim_2d = [uv_to_front(u, v) for u, v in trim_uv]
    openings_2d = {"eye_L": eye_poly(-1), "eye_R": eye_poly(1), "noseMouth": tri_poly()}
    xs = [p[0] for p in trim_2d]; ys = [p[1] for p in trim_2d]
    zs = [uv_to_3d(u, v)[2] for u, v in trim_uv]
    P["derived"] = {"U_MAX": round(U_MAX, 3), "V_MIN": round(V_MIN, 3), "V_MAX": round(V_MAX, 3),
                    "overallWidth": round(max(xs) - min(xs), 2), "overallHeight": round(max(ys) - min(ys), 2),
                    "overallDepth": round(-min(zs), 2), "Y_MIN": round(min(ys), 3), "Y_MAX": round(max(ys), 3),
                    "tileCount": len(tiles), "pinCount": len(pins), "sensorCount": len(sensors), "contactCount": len(contacts),
                    "fit": fit_report(), "contacts": contact_report(contacts)}
    P["outlines"] = {
        "trimUV": [[round(a, 3), round(b, 3)] for a, b in trim_uv],
        "trim2D": [[round(a, 3), round(b, 3)] for a, b in trim_2d],
        "openings2D": {k: [[round(a, 3), round(b, 3)] for a, b in v] for k, v in openings_2d.items()},
        "openingsUV": {k: [[round(c, 3) for c in front_to_uv(a, b)] for a, b in v] for k, v in openings_2d.items()},
        # holes through the shell, each a capsule [U0, V0, U1, V1, radius]
        "holesUV": [[*s["uv"], *s["uv"], SE["holeRadius"]] for s in sensors] + [[*slot, ST["radius"]] for slot in SLOTS]
                   + [[*c["uv"], *c["uv"], CT["stemHoleRadius"]] for c in contacts],
    }
    json.dump(P, open("params.json", "w"), indent=1)
    json.dump({"count": len(tiles), "tiles": tiles}, open("tiles.json", "w"))
    json.dump({"count": len(pins), "pins": pins}, open("pins.json", "w"))
    json.dump({"count": len(sensors), "sensors": sensors}, open("sensors.json", "w"))
    json.dump({"count": len(contacts), "contacts": contacts}, open("contacts.json", "w"))
    print(json.dumps(P["derived"], indent=1))
    import drawings; drawings.make_all(P, tiles, pins, sensors, contacts)
