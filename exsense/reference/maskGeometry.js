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
  const shellAt = (theta, phi, out = new THREE.Vector3()) => {
    const k = taper(phi);
    return out.set(a * k * Math.sin(theta) * Math.cos(phi), b * Math.sin(phi), c * Math.cos(theta) * Math.cos(phi) - c);
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

// ------------------------------------------------------------------ whole mask
export function buildMask(params, tilesJson, pinsJson) {
  const shell = makeShell(params);
  const root = new THREE.Group(); root.name = 'EX-SENSE';
  root.add(buildShellMesh(params, shell));
  root.add(buildPins(pinsJson, params));
  root.add(buildTiles(tilesJson, params, shell));
  return { root, shell };
}
