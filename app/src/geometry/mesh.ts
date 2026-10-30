export type Vec3 = [number, number, number]

export interface Mesh {
  positions: number[]
  indices: number[]
  /** Optional 0–1 tint per vertex, used to shade petals in the preview. */
  shade?: number[]
  /** Optional 0–1 position on the preview's heat ramp, per vertex. */
  tint?: number[]
}

export const emptyMesh = (): Mesh => ({ positions: [], indices: [] })

export function appendMesh(target: Mesh, source: Mesh) {
  const offset = target.positions.length / 3
  for (const v of source.positions) target.positions.push(v)
  for (const i of source.indices) target.indices.push(i + offset)
  if (source.shade) (target.shade ??= []).push(...source.shade)
  if (source.tint) (target.tint ??= []).push(...source.tint)
}

export function signedVolume(mesh: Mesh) {
  const { positions: p, indices: t } = mesh
  let sum = 0
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3
    const b = t[i + 1] * 3
    const c = t[i + 2] * 3
    sum +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
  }
  return sum / 6
}

/** Makes triangle normals face outward, as slicers expect. */
export function orientOutward(mesh: Mesh): Mesh {
  if (signedVolume(mesh) >= 0) return mesh
  const t = mesh.indices
  for (let i = 0; i < t.length; i += 3) {
    const swap = t[i + 1]
    t[i + 1] = t[i + 2]
    t[i + 2] = swap
  }
  return mesh
}

/** A grid of cells extruded between two surfaces. Open sides get walls, so it stays closed. */
export function solidGrid(
  nu: number,
  nv: number,
  keep: (i: number, j: number) => boolean,
  point: (i: number, j: number, layer: 0 | 1) => Vec3,
  shade?: (i: number, j: number) => number,
): Mesh {
  const mesh = emptyMesh()
  if (shade) mesh.shade = []
  const ids = new Map<number, number>()
  const vertex = (i: number, j: number, layer: 0 | 1) => {
    const key = (i * (nv + 1) + j) * 2 + layer
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      mesh.positions.push(...point(i, j, layer))
      if (shade) mesh.shade!.push(shade(i, j))
    }
    return id
  }
  const quad = (a: number, b: number, c: number, d: number) => {
    mesh.indices.push(a, b, c, a, c, d)
  }
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < nu && j < nv && keep(i, j)

  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      if (!keep(i, j)) continue
      const top = (a: number, b: number) => vertex(a, b, 1)
      const low = (a: number, b: number) => vertex(a, b, 0)
      quad(top(i, j), top(i + 1, j), top(i + 1, j + 1), top(i, j + 1))
      quad(low(i, j + 1), low(i + 1, j + 1), low(i + 1, j), low(i, j))
      if (!filled(i - 1, j)) quad(low(i, j), top(i, j), top(i, j + 1), low(i, j + 1))
      if (!filled(i + 1, j)) quad(low(i + 1, j + 1), top(i + 1, j + 1), top(i + 1, j), low(i + 1, j))
      if (!filled(i, j - 1)) quad(low(i + 1, j), top(i + 1, j), top(i, j), low(i, j))
      if (!filled(i, j + 1)) quad(low(i, j + 1), top(i, j + 1), top(i + 1, j + 1), low(i + 1, j + 1))
    }
  }
  return orientOutward(mesh)
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export function tube(path: Vec3[], radius: number, sides = 8): Mesh {
  const mesh = emptyMesh()
  let normal: Vec3 = [0, 1, 0]
  path.forEach((c, i) => {
    const dir = norm(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]))
    let side = cross(dir, normal)
    if (Math.hypot(...side) < 1e-4) side = cross(dir, [1, 0, 0])
    side = norm(side)
    normal = norm(cross(side, dir))
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2
      const s = Math.cos(a) * radius
      const n = Math.sin(a) * radius
      mesh.positions.push(
        c[0] + side[0] * s + normal[0] * n,
        c[1] + side[1] * s + normal[1] * n,
        c[2] + side[2] * s + normal[2] * n,
      )
    }
  })
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k
      const b = i * sides + (k + 1) % sides
      const c = a + sides
      const d = b + sides
      mesh.indices.push(a, b, d, a, d, c)
    }
  }
  const capStart = mesh.positions.length / 3
  mesh.positions.push(...path[0], ...path[path.length - 1])
  const last = (path.length - 1) * sides
  for (let k = 0; k < sides; k++) {
    const n = (k + 1) % sides
    mesh.indices.push(capStart, n, k)
    mesh.indices.push(capStart + 1, last + k, last + n)
  }
  return orientOutward(mesh)
}

export function sphere(center: Vec3, radius: number, rings = 6, sides = 10): Mesh {
  const mesh = emptyMesh()
  for (let r = 1; r < rings; r++) {
    const phi = (r / rings) * Math.PI
    for (let s = 0; s < sides; s++) {
      const theta = (s / sides) * Math.PI * 2
      mesh.positions.push(
        center[0] + radius * Math.sin(phi) * Math.cos(theta),
        center[1] + radius * Math.cos(phi),
        center[2] + radius * Math.sin(phi) * Math.sin(theta),
      )
    }
  }
  const north = mesh.positions.length / 3
  mesh.positions.push(center[0], center[1] + radius, center[2])
  mesh.positions.push(center[0], center[1] - radius, center[2])
  const at = (r: number, s: number) => (r - 1) * sides + (s % sides)
  for (let s = 0; s < sides; s++) {
    mesh.indices.push(north, at(1, s + 1), at(1, s))
    mesh.indices.push(north + 1, at(rings - 1, s), at(rings - 1, s + 1))
    for (let r = 1; r < rings - 1; r++) {
      mesh.indices.push(at(r, s), at(r, s + 1), at(r + 1, s + 1), at(r, s), at(r + 1, s + 1), at(r + 1, s))
    }
  }
  return orientOutward(mesh)
}

/** True when every edge belongs to exactly two triangles. */
export function isClosed(mesh: Mesh) {
  const edges = new Map<string, number>()
  const t = mesh.indices
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = t[i + k]
      const b = t[i + (k + 1) % 3]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  return [...edges.values()].every((n) => n === 2)
}
