"""
EX-SENSE mask — single-source geometry generator.

Units: millimetres. Three.js axes: +Y up, +Z toward viewer (mask faces +Z), +X viewer's right.
Origin = front-most point of the shell outer surface (between the eyes).

Surface parameter space ("UV", in mm):   U = a * theta ,  V = b * phi
Every petal is stored in UV plus an offset. Map any UV point to 3D with
    shellAt(U/a, V/b) + shellNormal(U/a, V/b) * (relief(U, V) + offset)

Run:  python generate.py      -> params.json, tiles.json, drawings/*.svg
Needs: numpy, scipy, scikit-image
"""
import json, math, os
import numpy as np
from scipy import ndimage
from scipy.interpolate import LinearNDInterpolator, griddata
from scipy.spatial import Delaunay
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
    # Sculpted face, in mm added to the shell. It only ever adds height, so the fit to the face can only get looser.
    "relief": {
        "stepUV": 2.0, "smooth": 2.0, "brow": 7.5, "bridge": 8.5, "noseWings": 5.0, "cheek": 8.0, "chin": 5.0, "dome": 3.0,
        "socketDepth": 0.94, "socketReach": 9.0,   # falls away toward the eye, so the eye sits in a hollow
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
        "thickness": 0.8,                       # petal thickness
        "travelIn": 1.5,                        # SPACE state: petal pushed inward
        "outlineStep": 1.2,                     # resample spacing of cell outlines
        "raster": 0.2,                          # contour raster resolution
        # One petal per diamond cell, its fullest part on the cell centre. Tips point up.
        "petal": {
            "ns": 44, "nt": 13,                 # grid along and across a petal
            "length": 50.0, "width": 28.0, "fullArea": 130.0, "minScale": 0.72, "scalePower": 0.35,
            "bloomInner": 0.95, "bloomOuter": 1.30, "bloomPower": 1.5,   # petals grow from the middle of the face to the edge
            "flare": 1.5, "lean_deg": 4.0, "maxTurn_deg": 24.0, "bow": 2.4,
            "base": 8.5,                        # height at the centre of the petal's lattice cell
            # Every petal tilts the same way. Two petals that overlap then differ by the same amount everywhere, so they cannot cross.
            "slopeV": 0.2, "slopeU": 0.09,     # mm per mm: up toward the tip, and up toward the outer edge
            "cup": 0.35, "ruffle": 0.35, "edgeWave": 0.05,
            "openingMargin": 0.9, "collarClearance": 1.0, "edgeMargin": -6.0,   # negative: tips pass the shell edge by this much
            "seamClearance": 0.5, "stemClearance": 2.5,
            "airGap": 0.2,                      # left between parts, on top of thickness and travel
        },
    },
    "pins": {"radius": 1.5, "height": 1.0, "baseOffset": 0.0},   # low posts at lattice vertices
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
        "maxReach": 26.0,                       # a tile further than this from the face gets no contact
        "openingMargin": 1.0,                   # pads stay this far outside the eye and nose openings
        "minPadGap": 1.0,                       # pads keep at least this far apart
        "minPerSector": 3,
    },
}
S, T, O, TL = P["shell"], P["trim"], P["openings"], P["tiles"]
SE, ST, CT = P["sensors"], P["straps"], P["contacts"]
RF, PT = P["relief"], TL["petal"]
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
    th, ph = u / A, v / B; p = shell(th, ph); n = normal_tp(th, ph); h = relief_at(u, v) + off
    return [p[i] + n[i] * h for i in range(3)]

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

def make_relief():
    Ug, Vg = np.meshgrid(RELIEF_U, RELIEF_V); X, Y = uv_to_front_np(Ug, Vg); ax = np.abs(X)
    eye = np.maximum(np.minimum(sdf_eye(X, Y, 1), sdf_eye(X, Y, -1)), 0.0); nose = np.maximum(sdf_tri(X, Y), 0.0)
    brow = RF["brow"] * np.exp(-((Y - (33.0 - 0.006 * (ax - 22.0) ** 2)) / 8.5) ** 2) * np.exp(-((ax - 28.0) / 36.0) ** 2)
    bridge = RF["bridge"] * np.exp(-(X / 10.0) ** 2) * np.clip((Y - 2.0) / 10.0, 0, 1) * np.exp(-(np.maximum(Y - 26.0, 0) / 18.0) ** 2)
    wings = RF["noseWings"] * np.exp(-(nose / 7.0) ** 2) * np.clip((Y + 52.0) / 22.0, 0, 1)
    cheek = RF["cheek"] * np.exp(-((ax - 50.0) / 23.0) ** 2 - ((Y + 24.0) / 17.0) ** 2)
    chin = RF["chin"] * np.exp(-(X / 28.0) ** 2 - ((Y + 84.0) / 9.0) ** 2)
    dome = RF["dome"] * np.exp(-((Y - 64.0) / 26.0) ** 2 - (X / 46.0) ** 2)
    socket = 1.0 - RF["socketDepth"] * np.exp(-(eye / RF["socketReach"]) ** 2)
    raised = (np.maximum.reduce([brow, bridge, cheek]) + wings + chin + dome) * socket
    return ndimage.gaussian_filter(raised, RF["smooth"] / RF["stepUV"])

RELIEF_U = np.arange(-126.0, 128.0, RF["stepUV"]); RELIEF_V = np.arange(-136.0, 150.0, RF["stepUV"])
RELIEF = make_relief()

def relief_at(u, v):
    """Bilinear, the same in maskGeometry.js."""
    x = min(len(RELIEF_U) - 1.001, max(0.0, (u - RELIEF_U[0]) / RF["stepUV"])); y = min(len(RELIEF_V) - 1.001, max(0.0, (v - RELIEF_V[0]) / RF["stepUV"]))
    i, j = int(x), int(y); a, b = x - i, y - j
    return float(RELIEF[j, i] * (1 - a) * (1 - b) + RELIEF[j, i + 1] * a * (1 - b) + RELIEF[j + 1, i] * (1 - a) * b + RELIEF[j + 1, i + 1] * a * b)

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

# ------------------------------------------------------------------ 5. TILES
def build_cells():
    """The diamond cells. Each gives one petal its place, sector and zone."""
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
                tiles.append({"cell": [i, j], "piece": k, "centroidUV": pts.mean(0), "areaUV": abs(area(pts))})
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
            "normal": [round(x, 5) for x in normal_tp(cu / A, cv / B)],
            "cellAreaUV": round(float(t["areaUV"]), 2), "sector": sector_of(fx, fy), "zone": zone_of(fx, fy),
        })
    return out

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

# ------------------------------------------------------------------ 5b. PETALS
def room(p):
    """Free distance at a UV point, right half: clear of openings, sensors, strap slots, the edge and the centre seam."""
    U, V = np.array([[p[0]]]), np.array([[p[1]]]); X, Y = uv_to_front_np(U, V)
    return min(float(sdf_openings_front(X, Y)[0, 0]) - PT["openingMargin"], float(sdf_features(U, V)[0, 0]) + SE["tileClearance"] - PT["collarClearance"],
               -float(sdf_trim(U, V)[0, 0]) - PT["edgeMargin"], p[0] - PT["seamClearance"])

def upright(u, v, lean):
    """Surface direction that reads as upright from the front, whatever the curve of the shell does to the UV lines."""
    e = 0.5; x0, y0 = uv_to_front(u, v); xu, yu = uv_to_front(u + e, v); xv, yv = uv_to_front(u, v + e)
    J = np.array([[xu - x0, xv - x0], [yu - y0, yv - y0]]) / e
    d = np.linalg.solve(J, np.array([math.sin(lean), math.cos(lean)])); d = d / np.hypot(*d)
    limit = R(PT["maxTurn_deg"]); a = max(-limit, min(limit, math.atan2(d[0], d[1])))
    return np.array([math.sin(a), math.cos(a)])

def petal_shape(c, L, W, idx, lattice):
    """UV grid and offsets of one petal. Tip, base and both edges stop short of whatever must stay clear."""
    cu, cv = c; c = np.array(c, float)
    free = lambda q: room(q) >= 0
    rho = min(1.0, math.hypot(cu / T["halfU"], (cv - 14.0) / T["halfV"]))
    d = upright(cu, cv, R(PT["lean_deg"]) * cu / T["halfU"])
    up, down = 0.58 * L, 0.42 * L
    for a in np.arange(0.5, up + 0.5, 0.5):
        if not free(c + d * a): up = a - 0.5; break
    for a in np.arange(0.5, down + 0.5, 0.5):
        if not free(c - d * a): down = a - 0.5; break
    span = up + down
    if span < 4: return None
    ns, nt = PT["ns"], PT["nt"]; s = np.linspace(0, 1, ns); sideways = np.array([d[1], -d[0]])
    bow = PT["bow"] * L / PT["length"] * math.sin(idx * 2.4)
    fine = np.linspace(0, 1, 121); line = c - d * down + np.outer(fine * span, d) + np.outer(np.sin(math.pi * fine) * bow, sideways)
    clear = np.array([free(q) for q in line])                         # the curved centre line must stay clear too
    if clear.sum() < 2: return None
    mid = int(np.argmin(np.abs(fine - down / span)))
    lo = max([k for k in range(mid + 1) if not clear[k]], default=-1) + 1
    hi = min([k for k in range(mid, 121) if not clear[k]], default=121) - 1
    if hi <= lo: return None
    spine = np.stack([np.interp(fine[lo] + s * (fine[hi] - fine[lo]), fine, line[:, a]) for a in (0, 1)], -1)
    span *= fine[hi] - fine[lo]
    if span < 4: return None
    nor = np.stack([-d[1] * np.ones(ns), d[0] * np.ones(ns)], -1)
    prof = np.sin(math.pi * s ** 0.82) ** 0.85; prof = prof / prof.max()   # soft shoulders, gently narrowing tip
    wave = 1 + PT["edgeWave"] * np.sin(s * 9 + idx * 1.7) * prof
    half = []
    for sign in (1, -1):
        w = W / 2 * prof * wave
        for i in range(ns):
            for e in np.arange(0.25, w[i] + 0.25, 0.25):
                if not free(spine[i] + sign * nor[i] * e):
                    w[i] = max(0.2, e - 0.25); break
        half.append(np.maximum(np.minimum(ndimage.gaussian_filter1d(w, 2.0, mode="nearest") * prof ** 0.12, w + 0.15), 0.25))   # the ends stay a real edge, so the solid closes
    uv = np.zeros((ns, nt, 2)); off = np.zeros((ns, nt)); tt = np.linspace(-1, 1, nt)
    for i in range(ns):
        local = (W / 2 * prof[i]) / 14
        for j in range(nt):
            q = tt[j]; uv[i, j] = spine[i] + nor[i] * q * (half[0][i] if q >= 0 else half[1][i])
            off[i, j] = PT["cup"] * q * q * local + PT["ruffle"] * math.sin(s[i] * 8 + idx * 2.1) * q * q * local
            off[i, j] += (PT["base"] + PT["slopeV"] * (uv[i, j, 1] - lattice[1]) + PT["slopeU"] * (abs(uv[i, j, 0]) - abs(lattice[0])) + PT["flare"] * rho * rho * s[i] ** 3)
    return {"tint": idx, "cu": cu, "cv": cv, "lattice": lattice, "uv": uv, "off": off, "size": round(L / PT["length"], 2),
            "length": round(float(span), 1), "width": round(float(half[0].max() + half[1].max()), 1)}

def moving_petal(t, idx):
    cu, cv = t["centroidUV"]; rho = min(1.0, math.hypot(cu / T["halfU"], (cv - 14.0) / T["halfV"]))
    k = max(PT["minScale"], min(1.0, (t["cellAreaUV"] / PT["fullArea"]) ** PT["scalePower"]))
    k = (k + (1 - k) * max(0.0, (rho - 0.75) / 0.25)) * (PT["bloomInner"] + (PT["bloomOuter"] - PT["bloomInner"]) * rho ** PT["bloomPower"])
    lattice = (t["cell"][0] * TL["latticeDiagU"] / 2, t["cell"][1] * TL["latticeDiagV"] / 2)      # measured from the lattice, so a clipped cell keeps its place in the stack
    p = petal_shape((cu, cv), PT["length"] * k, PT["width"] * k, idx, lattice); assert p, f"no room for a petal on {t['id']}"
    p["tile"] = t
    return p

def ring_of(p):
    return np.vstack([p["uv"][:, 0], p["uv"][::-1, -1]])

def stack_order(p):
    """Bottom first: the top of the mask down and the outside in. Lower petals lie over upper ones, inner over outer."""
    return (-float(p["lattice"][1]), -abs(float(p["lattice"][0])))

def pick_anchor(p, lower):
    """Where the stem leaves: deep inside this petal, with no lower petal in its way. On a 0.5 grid, so left mirrors right."""
    ring = ring_of(p); lo, hi = np.floor(ring.min(0) * 2) / 2, np.ceil(ring.max(0) * 2) / 2
    grid = np.stack(np.meshgrid(np.arange(lo[0], hi[0], 0.5), np.arange(lo[1], hi[1], 0.5)), -1).reshape(-1, 2)
    grid = grid[measure.points_in_poly(grid, ring)]
    grid = grid[np.linalg.norm(grid[:, None] - ring[None], axis=2).min(1) >= PT["stemClearance"]]
    for o in lower:
        if not len(grid): break
        other = ring_of(o)
        grid = grid[~measure.points_in_poly(grid, other) & (np.linalg.norm(grid[:, None] - other[None], axis=2).min(1) >= PT["stemClearance"])]
    if not len(grid): return None
    return grid[int(np.linalg.norm(grid - np.array([p["cu"], p["cv"]]), axis=1).argmin())]

G_STEP = 0.5
GRID_U = np.arange(-20.0, 140.0, G_STEP); GRID_V = np.arange(-150.0, 160.0, G_STEP)

def raster(p, off=None):
    """Height of a petal on the shared grid, as a window into it."""
    uv = p["uv"]; pts = uv.reshape(-1, 2)
    i0 = max(int((pts[:, 0].min() - GRID_U[0]) / G_STEP) - 8, 0); i1 = min(int((pts[:, 0].max() - GRID_U[0]) / G_STEP) + 9, len(GRID_U))
    j0 = max(int((pts[:, 1].min() - GRID_V[0]) / G_STEP) - 8, 0); j1 = min(int((pts[:, 1].max() - GRID_V[0]) / G_STEP) + 9, len(GRID_V))
    X, Y = np.meshgrid(GRID_U[i0:i1], GRID_V[j0:j1]); ring = ring_of(p)
    mask = measure.grid_points_in_poly(X.shape, np.stack([(ring[:, 1] - GRID_V[j0]) / G_STEP, (ring[:, 0] - GRID_U[i0]) / G_STEP], -1))
    mask = ndimage.binary_dilation(mask, iterations=2)                # includes the rim
    vals = (p["off"] if off is None else off).reshape(-1)
    if "mesh" not in p: p["mesh"] = Delaunay(pts)                     # the outline never changes, only the heights
    H = LinearNDInterpolator(p["mesh"], vals)(X, Y)
    return (j0, j1, i0, i1), mask, np.where(np.isnan(H), griddata(pts, vals, (X, Y), method="nearest"), H)

def group_of(p):
    """Petals in one sector and zone move together, so they only need to clear each other's thickness."""
    return (p["tile"]["sector"], p["tile"]["zone"])

def clearance_to(p, other):
    """Top to top. Across groups a petal also keeps its travel, because the one beneath may stay where it is."""
    return TL["thickness"] + PT["airGap"] + (TL["travelIn"] if group_of(p) != other else 0.0)

def stack(petals, posts):
    """Lay petals one at a time. Each stays where its tilt puts it, and rises only where it would otherwise meet what is beneath."""
    floor = np.zeros((len(GRID_V), len(GRID_U)))
    gx, gy = np.meshgrid(GRID_U, GRID_V)
    for u, v in posts: floor = np.where(np.hypot(gx - u, gy - v) < P["pins"]["radius"] + 0.3, P["pins"]["height"], floor)
    tops = {"floor": floor}
    for rank, p in enumerate(sorted(petals, key=stack_order)):
        p["rank"] = rank
        (j0, j1, i0, i1), mask, H = raster(p); g = group_of(p)
        need = np.zeros(H.shape)
        for other, E in tops.items(): need = np.maximum(need, np.where(mask, E[j0:j1, i0:i1] + clearance_to(p, other) - H, 0.0))
        lift = ndimage.gaussian_filter(ndimage.maximum_filter(need, size=13), 3.0)      # wider than the grid, so no lift falls between its points
        p["off"] = p["off"] + ndimage.map_coordinates(lift, [(p["uv"][..., 1] - GRID_V[j0]) / G_STEP, (p["uv"][..., 0] - GRID_U[i0]) / G_STEP], order=1, mode="nearest")
        E = tops.setdefault(g, np.zeros(floor.shape)); E[j0:j1, i0:i1] = np.where(mask, np.maximum(E[j0:j1, i0:i1], H + lift), E[j0:j1, i0:i1])

def mirrored(p, tint_shift=37):
    return {**{k: v for k, v in p.items() if k != "mesh"}, "cu": -p["cu"], "uv": (p["uv"] * [-1, 1])[:, ::-1], "off": p["off"][:, ::-1], "tint": p["tint"] + tint_shift}

def flat(a):
    return [round(float(x), 2) for x in a.reshape(-1)]

def petal_json(p):
    return {"uv": flat(p["uv"]), "off": flat(p["off"]), "rank": p["rank"], "tint": p["tint"], "size": p["size"]}

def offset_at(p, u, v):
    return float(griddata(p["uv"].reshape(-1, 2), p["off"].reshape(-1), (u, v), method="linear"))

# ------------------------------------------------------------------ 6. PINS (low posts at lattice vertices)
def build_pins(cells):
    du, dv = TL["latticeDiagU"], TL["latticeDiagV"]; pins = []
    for j in range(int(V_MIN / (dv / 2)) - 2, int(V_MAX / (dv / 2)) + 3):
        for i in range(-int(U_MAX / (du / 2)) - 2, int(U_MAX / (du / 2)) + 3):
            if (i + j) % 2: continue                          # lattice vertices = even (i+j)
            u, v = i * du / 2, j * dv / 2
            Ug, Vg = np.array([[u]]), np.array([[v]]); X, Y = uv_to_front_np(Ug, Vg)
            if sdf_trim(Ug, Vg)[0, 0] > -TL["edgeMargin"] - 2 or sdf_shell_rect(Ug, Vg)[0, 0] > -2: continue
            if sdf_openings_front(X, Y)[0, 0] < TL["openingMargin"] + 1: continue
            if sdf_features(Ug, Vg)[0, 0] < P["pins"]["radius"]: continue
            near = sum(1 for t in cells if abs(t["centroidUV"][0] - u) < du * 0.6 and abs(t["centroidUV"][1] - v) < dv * 0.6)
            if near < 2: continue                             # keep only where at least 2 cells meet around it
            pins.append({"id": f"N{len(pins):03d}", "uv": [round(u, 3), round(v, 3)], "p2D": [round(float(X[0,0]), 3), round(float(Y[0,0]), 3)],
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

def build_contacts(tiles):
    z_at = reference_face(); out = []
    for t in tiles:
        if t["anchorUV"] is None: continue
        u, v = t["anchorUV"]; under = t["underOffset"]
        n = np.array(normal_tp(u / A, v / B)); start = np.array(uv_to_3d(u, v, -S["thickness"]))
        reach = next((d for d in np.arange(0.0, CT["maxReach"], 0.05)
                      if (start - n * d)[2] <= z_at(*(start - n * d)[:2])), None)
        if reach is None or reach < CT["padHeight"] + CT["tipGap"]: continue
        tip = start - n * (reach - CT["tipGap"])
        room = sdf_openings_front(np.array([[tip[0]]]), np.array([[tip[1]]]))[0, 0] - CT["openingMargin"]
        thermal = t["zone"] in CT["thermalZones"] and room >= CT["thermalPadRadius"]
        if room < CT["padRadius"]: continue
        out.append({"id": "C" + t["id"][1:], "tile": t["id"], "uv": [round(u, 3), round(v, 3)], "sector": t["sector"], "zone": t["zone"],
                    "base3D": [round(x, 3) for x in uv_to_3d(u, v, under)], "axis": [round(float(x), 5) for x in -n],
                    "length": round(under + S["thickness"] + float(reach) - CT["tipGap"], 2),
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

# ------------------------------------------------------------------ 10. CHECKS ON THE FINISHED PETALS
def triangles(g):
    a = g[:-1, :-1].reshape(-1, 3); b = g[1:, :-1].reshape(-1, 3); c = g[:-1, 1:].reshape(-1, 3); d = g[1:, 1:].reshape(-1, 3)
    return np.vstack([a, b]), np.vstack([b, d]), np.vstack([c, c])

def rim_of(g):
    r = np.vstack([g[:, 0], g[::-1, -1]]); return r[:-1], r[1:]

def segment_hits(p0, p1, a, b, c):
    """Segments passing through triangles (Moller-Trumbore), all against all."""
    e1, e2 = b - a, c - a; d = p1 - p0; count = 0
    for s0, sd in zip(p0, d):
        h = np.cross(sd, e2); det = np.sum(e1 * h, axis=1); ok = np.abs(det) > 1e-9
        f = np.zeros_like(det); f[ok] = 1 / det[ok]
        t0 = s0 - a; u = f * np.sum(t0 * h, axis=1); q = np.cross(t0, e1); v = f * np.sum(sd * q, axis=1); w = f * np.sum(e2 * q, axis=1)
        count += int(np.sum(ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (w >= 0) & (w <= 1)))
    return count

def to_3d(p):
    g = np.zeros(p["uv"].shape[:2] + (3,))
    for i in range(g.shape[0]):
        for j in range(g.shape[1]):
            g[i, j] = uv_to_3d(float(p["uv"][i, j, 0]), float(p["uv"][i, j, 1]), float(p["off"][i, j]))
    return g

def rim_crossings(everyone):
    """Any rim that passes through another petal's surface, in true 3D."""
    grids = [to_3d(p) for p in everyone]
    boxes = [(g.reshape(-1, 3).min(0) - 0.01, g.reshape(-1, 3).max(0) + 0.01) for g in grids]; found = 0
    for i, g in enumerate(grids):
        p0, p1 = rim_of(g)
        for j, o in enumerate(grids):
            lo, hi = np.maximum(boxes[i][0], boxes[j][0]), np.minimum(boxes[i][1], boxes[j][1])
            if i == j or np.any(hi < lo): continue
            keep = np.all((np.maximum(p0, p1) >= lo) & (np.minimum(p0, p1) <= hi), axis=1)
            if not keep.any(): continue
            a, b, c = triangles(o)
            near = np.all((np.maximum.reduce([a, b, c]) >= lo) & (np.minimum.reduce([a, b, c]) <= hi), axis=1)
            if near.any() and segment_hits(p0[keep], p1[keep], a[near], b[near], c[near]): found += 1
    return found

def pushed_gap(right_half):
    """Smallest air gap between any petal and what lies beneath it, with a moving petal pushed in and the other group left at rest."""
    best = 1e9
    rs = [(p, *raster(p)) for p in sorted(right_half, key=stack_order)]
    for i, (p, (j0, j1, i0, i1), m, H) in enumerate(rs):
        for o, (a0, a1, b0, b1), n, K in rs[:i]:
            r0, r1, c0, c1 = max(j0, a0), min(j1, a1), max(i0, b0), min(i1, b1)
            if r0 >= r1 or c0 >= c1: continue
            both = m[r0 - j0:r1 - j0, c0 - i0:c1 - i0] & n[r0 - a0:r1 - a0, c0 - b0:c1 - b0]
            if both.any():
                gap = H[r0 - j0:r1 - j0, c0 - i0:c1 - i0] - clearance_to(p, group_of(o)) + PT["airGap"] - K[r0 - a0:r1 - a0, c0 - b0:c1 - b0]
                best = min(best, float(gap[both].min()))
    return round(best, 2)

def petals_beneath(right_half):
    """For each petal, how far it can go in on its own before it meets each petal lying under it."""
    out = {}
    rs = [(p, *raster(p)) for p in sorted(right_half, key=stack_order)]
    for i, (p, (j0, j1, i0, i1), m, H) in enumerate(rs):
        row = out.setdefault(p["tile"]["id"], [])
        for o, (a0, a1, b0, b1), n, K in rs[:i]:
            r0, r1, c0, c1 = max(j0, a0), min(j1, a1), max(i0, b0), min(i1, b1)
            if r0 >= r1 or c0 >= c1: continue
            both = m[r0 - j0:r1 - j0, c0 - i0:c1 - i0] & n[r0 - a0:r1 - a0, c0 - b0:c1 - b0]
            if both.any():
                gap = H[r0 - j0:r1 - j0, c0 - i0:c1 - i0] - TL["thickness"] - K[r0 - a0:r1 - a0, c0 - b0:c1 - b0]
                row.append([o["tile"]["id"], round(float(gap[both].min()), 2)])
    return out

def coverage(everyone):
    cu = np.arange(-112.0, 112.0, 0.5); cv = np.arange(-118.0, 130.0, 0.5); Ug, Vg = np.meshgrid(cu, cv); X, Y = uv_to_front_np(Ug, Vg)
    solid = (sdf_trim(Ug, Vg) < 0) & (sdf_shell_rect(Ug, Vg) < 0) & (sdf_openings_front(X, Y) > 0) & (sdf_features(Ug, Vg) + SE["tileClearance"] > 0)
    covered = np.zeros(Ug.shape, bool)
    for p in everyone:
        ring = ring_of(p)
        covered |= measure.grid_points_in_poly(Ug.shape, np.stack([(ring[:, 1] - cv[0]) / 0.5, (ring[:, 0] - cu[0]) / 0.5], -1))
    return round(float((covered & solid).sum() / solid.sum()) * 100, 1)

def sensor_view(everyone, sensors):
    """How far off its axis each sensor can see before a petal gets in the way. 90 = nothing above the lens."""
    out = {}
    for s in sensors:
        c = np.array(s["base3D"]); n = np.array(s["normal"]); lens = c + n * SE["lensTop"]; best = 90.0
        for p in everyone:
            if abs(p["cu"] - s["uv"][0]) > 70 or abs(p["cv"] - s["uv"][1]) > 70: continue
            g = p["grid"].reshape(-1, 3) - lens; h = g @ n; side = np.linalg.norm(g - np.outer(h, n), axis=1); up = h > 0
            if up.any(): best = min(best, float(np.degrees(np.arctan2(side[up], h[up])).min()))
        out[s["id"]] = round(best, 1)
    return out

# ------------------------------------------------------------------ main
if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    cells = build_cells(); pins = build_pins(cells); sensors = build_sensors()
    right = [t for t in cells if t["centroidUV"][0] > 0]
    assert len(right) * 2 == len(cells)
    tops = [moving_petal(t, i) for i, t in enumerate(right)]
    ordered = sorted(tops, key=stack_order)
    for i, p in enumerate(ordered): p["anchor"] = pick_anchor(p, ordered[:i])
    stack(tops, [n["uv"] for n in pins if n["uv"][0] >= 0])

    left = [t for t in cells if t["centroidUV"][0] < 0]
    def finish(t, p, anchor):
        ring = ring_of(p); cu, cv = t["centroidUV"]
        return {**t, "areaUV": round(abs(area(ring)), 2), "outlineUV": [[round(float(a), 3), round(float(b), 3)] for a, b in ring],
                "centroid3D": [round(x, 3) for x in uv_to_3d(cu, cv, offset_at(p, cu, cv))],
                "anchorUV": None if anchor is None else [float(anchor[0]), float(anchor[1])],
                "underOffset": None if anchor is None else round(offset_at(p, float(anchor[0]), float(anchor[1])) - TL["thickness"], 2),
                "petal": petal_json(p)}
    tiles = []; everyone = []; twins = {}
    for p in tops:
        t = p["tile"]; twin = min(left, key=lambda o: abs(o["centroidUV"][0] + t["centroidUV"][0]) + abs(o["centroidUV"][1] - t["centroidUV"][1]))
        q = mirrored(p); a = p["anchor"]; twins[t["id"]] = twin["id"]
        tiles += [finish(t, p, a), finish(twin, q, None if a is None else a * [-1, 1])]; everyone += [p, q]
    tiles.sort(key=lambda t: t["id"])
    under = petals_beneath(tops)
    for t in tiles:
        side = next((k for k, v in twins.items() if v == t["id"]), None)
        t["beneath"] = [[twins[i], g] for i, g in under[side]] if side else under[t["id"]]
    contacts = build_contacts(tiles)
    for p in everyone: p["grid"] = to_3d(p)
    trim_uv = trim_poly_uv(); trim_2d = [uv_to_front(u, v) for u, v in trim_uv]
    openings_2d = {"eye_L": eye_poly(-1), "eye_R": eye_poly(1), "noseMouth": tri_poly()}
    xs = [p[0] for p in trim_2d]; ys = [p[1] for p in trim_2d]
    zs = [uv_to_3d(u, v)[2] for u, v in trim_uv]
    P["derived"] = {"U_MAX": round(U_MAX, 3), "V_MIN": round(V_MIN, 3), "V_MAX": round(V_MAX, 3),
                    "overallWidth": round(max(xs) - min(xs), 2), "overallHeight": round(max(ys) - min(ys), 2),
                    "overallDepth": round(-min(zs), 2), "Y_MIN": round(min(ys), 3), "Y_MAX": round(max(ys), 3),
                    "tileCount": len(tiles), "pinCount": len(pins), "sensorCount": len(sensors), "contactCount": len(contacts),
                    "fit": fit_report(), "contacts": contact_report(contacts),
                    "petals": {"rimCrossings": rim_crossings(everyone), "pushedGap": pushed_gap(tops), "coverPercent": coverage(everyone),
                               "highestAboveShell": round(max(float(p["off"].max()) for p in everyone), 2),
                               "highestTotal": round(max(float((p["off"] + np.vectorize(relief_at)(p["uv"][..., 0], p["uv"][..., 1])).max()) for p in everyone), 2), "reliefMax": round(float(RELIEF.max()), 2),
                               "length": [min(p["length"] for p in tops), max(p["length"] for p in tops)], "width": [min(p["width"] for p in tops), max(p["width"] for p in tops)],
                               "sensorViewDeg": sensor_view(everyone, sensors), "tilesWithoutStem": sum(t["anchorUV"] is None for t in tiles)}}
    assert P["derived"]["petals"]["rimCrossings"] == 0, "a petal passes through another"
    assert P["derived"]["petals"]["pushedGap"] >= 0.0, "a pushed petal would hit the one beneath"
    P["outlines"] = {
        "trimUV": [[round(a, 3), round(b, 3)] for a, b in trim_uv],
        "trim2D": [[round(a, 3), round(b, 3)] for a, b in trim_2d],
        "openings2D": {k: [[round(a, 3), round(b, 3)] for a, b in v] for k, v in openings_2d.items()},
        "openingsUV": {k: [[round(c, 3) for c in front_to_uv(a, b)] for a, b in v] for k, v in openings_2d.items()},
        # holes through the shell, each a capsule [U0, V0, U1, V1, radius]
        "reliefUV": {"u0": float(RELIEF_U[0]), "v0": float(RELIEF_V[0]), "step": RF["stepUV"], "nu": len(RELIEF_U), "nv": len(RELIEF_V),
                     "data": [round(float(x), 2) for x in RELIEF.reshape(-1)]},
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
