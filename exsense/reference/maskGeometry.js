// EX-SENSE mask — reference geometry for Three.js (r150+).
// Reads params.json / tiles.json / pins.json produced by generate.py.
// Units: millimetres. If the scene is in metres, scale the root group by 0.001 — never edit the data.
//
// Core rule: every vertex = shellAt(U/a, V/b) + shellNormal(U/a, V/b) * (relief(U, V) + offset)
// where (U, V) is the surface-parameter coordinate stored in tiles.json. Nothing is placed by eye.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ shell surface (must match generate.py)
export function makeShell(params) {
  const S = params.shell, R = THREE.MathUtils.degToRad;
  const a = S.a_halfWidth, b = S.b_halfHeight, c = S.c_depth;
  const taper = (phi) => 1 - S.chinTaper * Math.pow(Math.max(0, -Math.sin(phi)), S.chinTaperExp);
  const profile = (phi) => {
    const y = b * Math.sin(phi);
    return y >= 0
      ? -S.foreheadBack * Math.pow(y / S.profileTopY, S.profileExp)
      : -S.chinBack * Math.pow(-y / S.profileBottomY, S.profileExp);
  };
  const shellAt = (theta, phi, out = new THREE.Vector3()) => {
    const k = taper(phi);
    return out.set(a * k * Math.sin(theta) * Math.cos(phi), b * Math.sin(phi), c * (Math.cos(theta) - 1) * Math.cos(phi) + profile(phi));
  };
  const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _f = new THREE.Vector3();
  const normalAt = (theta, phi, out = new THREE.Vector3()) => {
    const e = 1e-4;
    shellAt(theta, phi, _p); shellAt(theta + e, phi, _t).sub(_p); shellAt(theta, phi + e, _f).sub(_p);
    out.crossVectors(_f, _t).normalize();
    if (out.z < 0) out.negate();
    return out;
  };
  // the sculpted face: mm added to the surface, bilinear, the same in generate.py
  const R_ = params.outlines.reliefUV;
  const relief = (u, v) => {
    const x = Math.min(R_.nu - 1.001, Math.max(0, (u - R_.u0) / R_.step)), y = Math.min(R_.nv - 1.001, Math.max(0, (v - R_.v0) / R_.step));
    const i = Math.floor(x), j = Math.floor(y), s = x - i, w = y - j, at = (p, q) => R_.data[q * R_.nu + p];
    return at(i, j) * (1 - s) * (1 - w) + at(i + 1, j) * s * (1 - w) + at(i, j + 1) * (1 - s) * w + at(i + 1, j + 1) * s * w;
  };
  const _n = new THREE.Vector3();
  // (U, V) in mm of parameter space -> 3D point offset along the normal
  const uvTo3D = (u, v, offset = 0, out = new THREE.Vector3()) => {
    const th = u / a, ph = v / b;
    return shellAt(th, ph, out).addScaledVector(normalAt(th, ph, _n), relief(u, v) + offset);
  };
  const uvNormal = (u, v, out = new THREE.Vector3()) => normalAt(u / a, v / b, out);
  return {
    a, b, shellAt, normalAt, uvTo3D, uvNormal, relief,
    thetaMax: R(S.thetaMax_deg), phiMin: R(S.phiMin_deg), phiMax: R(S.phiMax_deg),
  };
}

// ------------------------------------------------------------------ holes through the shell: capsules [U0, V0, U1, V1, r]
export function holeDistance(u, v, [u0, v0, u1, v1, r]) {
  const du = u1 - u0, dv = v1 - v0, l2 = du * du + dv * dv;
  const t = l2 ? Math.min(1, Math.max(0, ((u - u0) * du + (v - v0) * dv) / l2)) : 0;
  return Math.hypot(u - (u0 + t * du), v - (v0 + t * dv)) - r;
}

export function holeOutline([u0, v0, u1, v1, r], n = 24) {
  const a = (u0 === u1 && v0 === v1 ? 0 : Math.atan2(v1 - v0, u1 - u0)) + Math.PI / 2, pts = [];
  const arc = (cu, cv, start) => { for (let k = 0; k <= n; k++) { const t = start + (Math.PI * k) / n; pts.push([cu + r * Math.cos(t), cv + r * Math.sin(t)]); } };
  arc(u0, v0, a); arc(u1, v1, a + Math.PI);
  return pts;
}

// ------------------------------------------------------------------ shell mesh
// Dense theta/phi grid; outline + openings are cut by an alpha mask drawn in UV space,
// so cut edges are exact regardless of mesh density.
export function buildShellMesh(params, shell, material) {
  const segU = 180, segV = 220, D = params.derived;
  const U0 = -D.U_MAX, U1 = D.U_MAX, V0 = D.V_MIN, V1 = D.V_MAX;
  const pos = [], uv = [], idx = [], p = new THREE.Vector3();
  for (let j = 0; j <= segV; j++) {
    const v = V0 + (V1 - V0) * (j / segV);
    for (let i = 0; i <= segU; i++) {
      const u = U0 + (U1 - U0) * (i / segU);
      shell.uvTo3D(u, v, 0, p); pos.push(p.x, p.y, p.z); uv.push(i / segU, j / segV);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * (segU + 1) + i, b = a + 1, c = a + segU + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();

  const size = 2048, cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const px = ([u, v]) => [((u - U0) / (U1 - U0)) * size, (1 - (v - V0) / (V1 - V0)) * size];
  const fill = (poly, col) => {
    ctx.fillStyle = col; ctx.beginPath();
    poly.forEach((q, k) => { const [x, y] = px(q); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fill();
  };
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  fill(params.outlines.trimUV, '#fff');
  for (const poly of Object.values(params.outlines.openingsUV)) fill(poly, '#000');
  for (const hole of params.outlines.holesUV) fill(holeOutline(hole), '#000');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8;

  const mat = material ?? new THREE.MeshStandardMaterial({ color: 0xdcbcb0, roughness: 0.75 });
  mat.alphaMap = tex; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(g, mat); mesh.name = 'shell';
  return mesh;
}

// ------------------------------------------------------------------ one petal = closed solid
// A grid along and across the petal. The top sits at the stored offset, the underside one thickness below, walls join them.
const IVORY = new THREE.Color(0xf2e4da);
const DEFAULT_TINTS = ['#e39a98', '#e8aaa6', '#ecb6aa', '#97b39a', '#aec2a6', '#efc3a8', '#eed7cc'];
const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

export const tintOf = (petal, tints) => tints[Math.floor(hash(petal.tint + 3) * tints.length)];

// Colours a petal from ivory at the base to one of the palette colours at the tip. The choice is fixed per petal, never random.
export function paintPetal(geometry, petal, params, tints = DEFAULT_TINTS, strength = 1) {
  const { ns, nt } = params.tiles.petal, mid = (nt - 1) / 2, col = geometry.attributes.color.array, n = ns * nt, shade = new THREE.Color();
  const tint = new THREE.Color(tintOf(petal, tints));
  for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
    const k = i * nt + j, s = i / (ns - 1), t = Math.abs(j / mid - 1);
    shade.copy(IVORY).lerp(tint, strength * Math.min(1, 0.22 + 1.05 * Math.pow(s, 1.1)) * (0.75 + 0.25 * t));
    shade.toArray(col, 3 * k); shade.toArray(col, 3 * (k + n));
  }
  geometry.attributes.color.needsUpdate = true;
}

function petalGeometry(petal, thickness, params, shell) {
  const { ns, nt } = params.tiles.petal, n = ns * nt;
  const pos = new Float32Array(n * 6), col = new Float32Array(n * 6), idx = [], q = new THREE.Vector3();
  for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
    const k = i * nt + j, u = petal.uv[2 * k], v = petal.uv[2 * k + 1];
    shell.uvTo3D(u, v, petal.off[k], q); q.toArray(pos, 3 * k);
    shell.uvTo3D(u, v, petal.off[k] - thickness, q); q.toArray(pos, 3 * (k + n));
  }
  const quad = (a, b, c, d) => idx.push(a, b, d, d, b, c);
  for (let i = 0; i < ns - 1; i++) for (let j = 0; j < nt - 1; j++) {
    const a = i * nt + j, b = a + nt, c = b + 1, d = a + 1;
    quad(a, b, c, d); quad(d + n, c + n, b + n, a + n);
  }
  for (let i = 0; i < ns - 1; i++) {
    const a = i * nt, b = a + nt; quad(b, a, a + n, b + n);
    const c = a + nt - 1, e = c + nt; quad(c, e, e + n, c + n);
  }
  for (let j = 0; j < nt - 1; j++) {
    const a = j, b = j + 1; quad(a, b, b + n, a + n);
    const c = (ns - 1) * nt + j, e = c + 1; quad(e, c, c + n, e + n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  paintPetal(g, petal, params);
  return g;
}

export const buildTileGeometry = (tile, params, shell) => petalGeometry(tile.petal, params.tiles.thickness, params, shell);

// Gold rim, veins and a bead at the tip, one material group each so they can be switched separately. They ride with the petal.
function petalDetail(geometry, petal, params) {
  const { ns, nt } = params.tiles.petal, mid = (nt - 1) / 2, pos = geometry.attributes.position.array, nor = geometry.attributes.normal.array;
  const point = (i, j, lift) => {
    const j0 = Math.min(nt - 2, Math.floor(j)), f = j - j0, a = 3 * (i * nt + j0), b = a + 3;
    const p = new THREE.Vector3(pos[a] * (1 - f) + pos[b] * f, pos[a + 1] * (1 - f) + pos[b + 1] * f, pos[a + 2] * (1 - f) + pos[b + 2] * f);
    const n = new THREE.Vector3(nor[a], nor[a + 1], nor[a + 2]); if (n.z < 0) n.negate();
    return p.addScaledVector(n, lift);
  };
  const tube = (points, radius, segments, sides = 4) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, sides);
  const rim = [], veins = [];
  for (const j of [0, nt - 1]) {
    const edge = []; for (let i = 0; i < ns; i++) edge.push(point(i, j, 0));
    rim.push(tube(edge, 0.17, 70, 5));
  }
  const rib = []; for (let i = 2; i < ns - 2; i += 2) rib.push(point(i, mid, 0.08));
  veins.push(tube(rib, 0.1, 36));
  for (const f of [0.18, 0.34, 0.5, 0.66]) for (const side of [-1, 1]) {
    const start = Math.floor(f * ns), run = Math.min(ns - 1 - start, Math.floor(0.34 * ns)), vein = [];
    for (let k = 0; k <= 6; k++) { const a = k / 6; vein.push(point(start + Math.round(run * a), mid + side * mid * 0.92 * Math.pow(a, 0.8), 0.08)); }
    veins.push(tube(vein, 0.055, 12));
  }
  const tip = point(ns - 1, mid, 0.2);
  const bead = new THREE.SphereGeometry(0.45 + 0.65 * petal.size, 14, 10).translate(tip.x, tip.y, tip.z);
  return mergeGeometries([mergeGeometries(rim), mergeGeometries(veins), bead], true);
}

const gold = () => new THREE.MeshStandardMaterial({ color: 0xd9a56c, metalness: 1, roughness: 0.3 });
const hingeOf = (geometry, params) => {
  const { ns, nt } = params.tiles.petal, mid = (nt - 1) / 2, at = (i) => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i * nt + mid);
  return { pivot: at(0), along: at(ns - 1).sub(at(0)).normalize() };
};

export function buildTiles(tilesJson, params, shell, materialFor) {
  const grp = new THREE.Group(); grp.name = 'tiles';
  const trimMaterials = [gold(), gold(), gold()]; grp.userData.trim = { rim: trimMaterials[0], veins: trimMaterials[1], beads: trimMaterials[2] };
  for (const t of tilesJson.tiles) {
    const mat = materialFor ? materialFor(t) : new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, sheen: 0.25, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe9e2), transparent: true, opacity: 0.93 });
    const mesh = new THREE.Mesh(buildTileGeometry(t, params, shell), mat); mesh.castShadow = mesh.receiveShadow = true;
    mesh.renderOrder = 10 + t.petal.rank * 2;                      // the stacking order, so see-through layers blend correctly
    const trim = new THREE.Mesh(petalDetail(mesh.geometry, t.petal, params), trimMaterials);
    trim.castShadow = true; trim.renderOrder = mesh.renderOrder + 1; mesh.add(trim);
    mesh.name = t.id;
    const normal = new THREE.Vector3(...t.normal), { pivot, along } = hingeOf(mesh.geometry, params);
    const reach = Math.min(1, Math.hypot(t.centroid2D[0] / 76, (t.centroid2D[1] - 12) / 96));   // outer petals open furthest
    mesh.userData = { tile: t, normal, travel: 0, open: 0, pivot, hinge: new THREE.Vector3().crossVectors(along, normal).normalize(), openWeight: 0.35 + 0.65 * reach, sway: 0, size: 1, outward: t.centroid2D[0] > 0 ? -1 : 1 };
    grp.add(mesh);
  }
  return grp;
}

// A petal's pose: pushed in along its normal (0 ... params.tiles.travelIn mm), plus three display-only changes
// about its base: open (radians), sway sideways toward the mask edge (radians) and size.
const _q = new THREE.Quaternion(), _s = new THREE.Quaternion(), _p = new THREE.Vector3();
export function setTilePose(mesh, mm, open = mesh.userData.open, sway = mesh.userData.sway, size = mesh.userData.size) {
  const u = mesh.userData; u.travel = mm; u.open = open; u.sway = sway; u.size = size;
  _q.setFromAxisAngle(u.hinge, open * u.openWeight).multiply(_s.setFromAxisAngle(u.normal, sway * u.outward));
  mesh.quaternion.copy(_q); mesh.scale.setScalar(size);
  mesh.position.copy(u.pivot).sub(_p.copy(u.pivot).multiplyScalar(size).applyQuaternion(_q)).addScaledVector(u.normal, -mm);
  u.contact?.position.copy(u.normal).multiplyScalar(-mm);
}

// SPACE state: push a tile inward along its normal
export const setTileTravel = (mesh, mm) => setTilePose(mesh, mm);

// ------------------------------------------------------------------ pins (low posts at lattice vertices)
export function buildPins(pinsJson, params, material) {
  const P = params.pins;
  const geo = new THREE.CylinderGeometry(P.radius, P.radius, P.height, 20, 1).translate(0, P.height / 2, 0);
  const mat = material ?? new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.3, metalness: 0.8 });
  const inst = new THREE.InstancedMesh(geo, mat, pinsJson.pins.length); inst.name = 'pins';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  pinsJson.pins.forEach((p, i) => {
    Q.setFromUnitVectors(up, new THREE.Vector3(...p.normal));
    M.compose(new THREE.Vector3(...p.base3D), Q, one); inst.setMatrixAt(i, M);
  });
  return inst;
}

// ------------------------------------------------------------------ turned parts: closed solids around an axis
// profile = [[radius, height], ...], starting and ending on the axis (radius 0)
function revolve(profile, origin, axis, sides = 24) {
  const n = new THREE.Vector3(...axis), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  e1.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize(); e2.crossVectors(n, e1);
  const o = new THREE.Vector3(...origin), pos = [], idx = [], q = new THREE.Vector3();
  const rings = profile.slice(1, -1), ringAt = (i, k) => 1 + i * sides + ((k + sides) % sides);
  const vertex = (r, h, a) => { q.copy(o).addScaledVector(n, h).addScaledVector(e1, r * Math.cos(a)).addScaledVector(e2, r * Math.sin(a)); pos.push(q.x, q.y, q.z); };
  vertex(0, profile[0][1], 0);
  rings.forEach(([r, h]) => { for (let k = 0; k < sides; k++) vertex(r, h, (2 * Math.PI * k) / sides); });
  vertex(0, profile[profile.length - 1][1], 0);
  const top = pos.length / 3 - 1, last = rings.length - 1;
  for (let k = 0; k < sides; k++) {
    idx.push(0, ringAt(0, k + 1), ringAt(0, k), top, ringAt(last, k), ringAt(last, k + 1));
    for (let i = 0; i < last; i++) idx.push(ringAt(i, k), ringAt(i, k + 1), ringAt(i + 1, k + 1), ringAt(i, k), ringAt(i + 1, k + 1), ringAt(i + 1, k));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// A stem from the tile through the shell, ending in a soft domed pad. Starts at the tile underside.
export function buildContactGeometry(contact, params) {
  const C = params.contacts, L = contact.length, R = contact.padRadius, root = L - C.padHeight, dome = [];
  for (let k = 0; k <= 5; k++) { const a = (k / 6) * Math.PI / 2; dome.push([R * Math.cos(a), root + C.padHeight * Math.sin(a)]); }
  return revolve([[0, 0], [C.stemRadius, 0], [C.stemRadius, root], ...dome, [0, L]], contact.base3D, contact.axis);
}

// The printed collar that holds a sensor in its hole; the lens stands for the bought sensor module.
export function buildSensorGeometry(sensor, params) {
  const S = params.sensors, r = S.collarRadius, b = S.backOffset, t = S.collarTop;
  const at = (off) => sensor.base3D.map((c, i) => c + sensor.normal[i] * off);
  return {
    collar: revolve([[0, 0], [r, 0], [r, t - b - 0.5], [r - 0.5, t - b], [0, t - b]], at(b), sensor.normal),
    lens: revolve([[0, 0], [S.lensRadius, 0], [S.lensRadius * 0.8, (S.lensTop - t) * 0.8], [0, S.lensTop - t]], at(t), sensor.normal),
  };
}

// Sensors stay put. Contacts follow their petal's travel, not its opening.
export function buildSensors(sensorsJson, params) {
  const grp = new THREE.Group(); grp.name = 'sensors';
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.28, metalness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1a24, roughness: 0.12, metalness: 0.4 });
  for (const s of sensorsJson.sensors) {
    const { collar, lens } = buildSensorGeometry(s, params);
    const mesh = new THREE.Mesh(collar, metal); mesh.name = s.id;
    mesh.add(new THREE.Mesh(lens, glass)); grp.add(mesh);
  }
  return grp;
}

export function attachContacts(tiles, contactsJson, params) {
  const grp = new THREE.Group(); grp.name = 'contacts';
  const soft = new THREE.MeshStandardMaterial({ color: 0xe9e1d8, roughness: 0.6, metalness: 0 });
  for (const c of contactsJson.contacts) {
    const mesh = new THREE.Mesh(buildContactGeometry(c, params), soft); mesh.name = c.id;
    tiles.getObjectByName(c.tile).userData.contact = mesh;
    grp.add(mesh);
  }
  return grp;
}

// ------------------------------------------------------------------ whole mask
export function buildMask(params, tilesJson, pinsJson, sensorsJson, contactsJson) {
  const shell = makeShell(params);
  const root = new THREE.Group(); root.name = 'EX-SENSE';
  const base = buildShellMesh(params, shell, new THREE.MeshStandardMaterial({ color: 0xdcbcb0, roughness: 0.75 })); base.receiveShadow = true; root.add(base);
  root.add(buildPins(pinsJson, params));
  const tiles = buildTiles(tilesJson, params, shell);
  root.add(attachContacts(tiles, contactsJson, params));
  root.add(tiles);
  root.add(buildSensors(sensorsJson, params));
  return { root, shell };
}
