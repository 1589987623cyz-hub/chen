// EX-SENSE mask — reference geometry for Three.js (r150+). Tiles only.
// Reads params.json / tiles.json / pins.json produced by generate.py.
// Units: millimetres. If the scene is in metres, scale the root group by 0.001 — never edit the data.
//
// Core rule: every vertex = shellAt(U/a, V/b) + shellNormal(U/a, V/b) * offset
// where (U, V) is the surface-parameter coordinate stored in tiles.json. Nothing is placed by eye.

import * as THREE from 'three';

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
  const _n = new THREE.Vector3();
  // (U, V) in mm of parameter space -> 3D point offset along the normal
  const uvTo3D = (u, v, offset = 0, out = new THREE.Vector3()) => {
    const th = u / a, ph = v / b;
    return shellAt(th, ph, out).addScaledVector(normalAt(th, ph, _n), offset);
  };
  const uvNormal = (u, v, out = new THREE.Vector3()) => normalAt(u / a, v / b, out);
  return {
    a, b, shellAt, normalAt, uvTo3D, uvNormal,
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

// ------------------------------------------------------------------ shell mesh (dark base)
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

  const mat = material ?? new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.7, metalness: 0.1 });
  mat.alphaMap = tex; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(g, mat); mesh.name = 'shell';
  return mesh;
}

// ------------------------------------------------------------------ one tile = closed solid
// groups: bottom face, side wall, chamfer bevel, top face (separate vertices -> crisp edges)
export function buildTileGeometry(tile, params, shell) {
  const T = params.tiles;
  const o0 = T.undersideOffset, o2 = T.undersideOffset + T.thickness, o1 = o2 - T.chamfer;
  const pos = [], idx = [], q = new THREE.Vector3();
  const push = (u, v, off) => { shell.uvTo3D(u, v, off, q); pos.push(q.x, q.y, q.z); return pos.length / 3 - 1; };

  // top/bottom faces are pre-triangulated in tiles.json (UV verts + CCW tris, edges <= ~3 mm)
  const face = (mesh, off, flip) => {
    const base = pos.length / 3; for (const [u, v] of mesh.uv) push(u, v, off);
    for (const [a, b, c] of mesh.tris) flip ? idx.push(base + a, base + c, base + b) : idx.push(base + a, base + b, base + c);
  };
  // UV->3D keeps orientation (U ~ +X, V ~ +Y), so CCW in UV = facing +normal
  face(tile.topFace, o2, false);
  face(tile.bottomFace, o0, true);

  const band = (ringA, offA, ringB, offB) => {
    const n = ringA.length, base = pos.length / 3;
    for (let i = 0; i < n; i++) { push(ringA[i][0], ringA[i][1], offA); push(ringB[i][0], ringB[i][1], offB); }
    for (let i = 0; i < n; i++) {
      const a = base + 2 * i, b = a + 1, c = base + 2 * ((i + 1) % n), d = c + 1;
      idx.push(a, c, b, b, c, d);                                  // outward-facing for CCW rings
    }
  };
  band(tile.outlineUV, o0, tile.outlineUV, o1);                    // side wall
  band(tile.outlineUV, o1, tile.topUV, o2);                        // bevel

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildTiles(tilesJson, params, shell, materialFor) {
  const grp = new THREE.Group(); grp.name = 'tiles';
  for (const t of tilesJson.tiles) {
    const mat = materialFor ? materialFor(t) : new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.35, metalness: 0.75 });
    const mesh = new THREE.Mesh(buildTileGeometry(t, params, shell), mat);
    mesh.name = t.id;
    mesh.userData = { tile: t, normal: new THREE.Vector3(...t.normal), travel: 0 };
    grp.add(mesh);
  }
  return grp;
}

// SPACE state: push a tile inward along its normal (0 … params.tiles.travelIn mm)
export function setTileTravel(mesh, mm) {
  mesh.userData.travel = mm;
  mesh.position.copy(mesh.userData.normal).multiplyScalar(-mm);
}

// ------------------------------------------------------------------ pins (visible in gaps at lattice vertices)
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

// Sensors stay put. Contacts are children of their tile, so they travel with it.
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
  const soft = new THREE.MeshStandardMaterial({ color: 0xe9e1d8, roughness: 0.6, metalness: 0 });
  for (const c of contactsJson.contacts) {
    const mesh = new THREE.Mesh(buildContactGeometry(c, params), soft); mesh.name = c.id;
    tiles.getObjectByName(c.tile).add(mesh);
  }
}

// ------------------------------------------------------------------ whole mask
export function buildMask(params, tilesJson, pinsJson, sensorsJson, contactsJson) {
  const shell = makeShell(params);
  const root = new THREE.Group(); root.name = 'EX-SENSE';
  root.add(buildShellMesh(params, shell));
  root.add(buildPins(pinsJson, params));
  const tiles = buildTiles(tilesJson, params, shell);
  attachContacts(tiles, contactsJson, params);
  root.add(tiles);
  root.add(buildSensors(sensorsJson, params));
  return { root, shell };
}
