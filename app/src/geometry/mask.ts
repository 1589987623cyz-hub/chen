import { ZONES, type Config, type NumericValues, type Region, type ZoneId } from '@/domain/params'
import { appendMesh, emptyMesh, solidGrid, sphere, tube, type Mesh, type Vec3 } from './mesh'

export type WearState = 'standby' | 'adaptive' | 'full'
export type Side = 1 | -1
export type PartGroup = 'petals' | 'rails' | 'ear'
export type PartMaterial = 'petal' | 'frame' | 'node'

export interface Part {
  name: string
  group: PartGroup
  material: PartMaterial
  zone?: ZoneId
  side?: Side
  mesh: Mesh
}

type Point = [number, number]

interface PetalDef {
  id: string
  zone: ZoneId
  /** Tips of the petal in the front view, in drawing pixels. Left half only unless centred. */
  a: Point
  b: Point
  width: number
  layer: number
  centred?: boolean
}

// All layout below is measured from the three-view drawing, in its own pixel coordinates.
const CENTER_X = 408
const CENTER_Y = 440
const MM_PER_PX = 0.26

export const PETALS: PetalDef[] = [
  { id: 'crown', zone: 'Z1', a: [300, 183], b: [518, 183], width: 165, layer: 3, centred: true },
  { id: 'top', zone: 'Z1', a: [403, 68], b: [245, 152], width: 88, layer: 2 },
  { id: 'brow', zone: 'Z2', a: [280, 172], b: [176, 340], width: 96, layer: 3 },
  { id: 'edge-upper', zone: 'Z2', a: [240, 135], b: [124, 346], width: 54, layer: 0 },
  { id: 'centre', zone: 'Z3', a: [292, 195], b: [402, 424], width: 104, layer: 4 },
  { id: 'lid', zone: 'Z3', a: [190, 332], b: [338, 318], width: 78, layer: 0 },
  { id: 'temple', zone: 'Z4', a: [150, 350], b: [228, 548], width: 72, layer: 3 },
  { id: 'edge-mid', zone: 'Z4', a: [120, 372], b: [152, 556], width: 46, layer: 1 },
  { id: 'bridge', zone: 'Z5', a: [352, 332], b: [404, 430], width: 40, layer: 5 },
  { id: 'cheek-cross', zone: 'Z6', a: [398, 428], b: [238, 592], width: 62, layer: 4 },
  { id: 'under-eye', zone: 'Z7', a: [216, 482], b: [292, 484], width: 40, layer: 0 },
  { id: 'cheek', zone: 'Z8', a: [172, 526], b: [252, 672], width: 80, layer: 3 },
  { id: 'edge-low', zone: 'Z8', a: [156, 566], b: [236, 722], width: 46, layer: 1 },
  { id: 'jaw', zone: 'Z9', a: [196, 646], b: [296, 768], width: 58, layer: 1 },
  { id: 'chin', zone: 'Z10', a: [264, 624], b: [398, 816], width: 88, layer: 3 },
]

const EYE_OPENING: Point[] = [
  [212, 412], [238, 380], [285, 362], [335, 374], [368, 406], [345, 438], [300, 460], [252, 460], [222, 442],
]

const NOSE_MOUTH_OPENING: Point[] = [
  [408, 440], [360, 505], [300, 585], [276, 612], [304, 645], [404, 712],
  [512, 645], [540, 612], [516, 585], [456, 505],
]

export const mirrorPoint = ([x, y]: Point): Point => [2 * CENTER_X - x, y]

/** Every opening in drawing pixels. These stay clear in every state. */
export const OPENINGS: { id: 'eye' | 'nose'; points: Point[] }[] = [
  { id: 'eye', points: EYE_OPENING },
  { id: 'eye', points: EYE_OPENING.map(mirrorPoint) },
  { id: 'nose', points: NOSE_MOUTH_OPENING },
]

/** The clear aperture inside an opening: petals may rest on the rim but never enter this. */
export function clearAperture(points: Point[]): Point[] {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length
  return points.map(([x, y]) => [cx + (x - cx) * 0.88, cy + (y - cy) * 0.88])
}

export const insidePolygon = (points: Point[], x: number, y: number) => {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Front-view half width, and the side-view depth of the centre line and of the rim.
const ROWS = [60, 100, 150, 200, 260, 340, 420, 500, 560, 640, 700, 760, 815]
const HALF_WIDTH = [30, 168, 236, 268, 288, 298, 296, 282, 262, 226, 176, 116, 26]
const CENTRE_DEPTH = [110, 155, 240, 288, 314, 324, 325, 316, 296, 268, 255, 235, 205]
const RIM_DEPTH = [105, 90, 80, 68, 50, 24, 6, 8, 28, 58, 80, 115, 155]

function smoothTable(values: number[], y: number) {
  const row = Math.min(Math.max(y, ROWS[0]), ROWS[ROWS.length - 1])
  let i = 0
  while (i < ROWS.length - 2 && row > ROWS[i + 1]) i++
  const t = (row - ROWS[i]) / (ROWS[i + 1] - ROWS[i])
  const before = values[Math.max(i - 1, 0)]
  const a = values[i]
  const b = values[i + 1]
  const after = values[Math.min(i + 2, values.length - 1)]
  return a + 0.5 * t * (b - before + t * (2 * before - 5 * a + 4 * b - after + t * (3 * (a - b) + after - before)))
}

export interface MaskScale {
  x: number
  y: number
  z: number
}

export const maskScale = (v: NumericValues): MaskScale => ({
  x: (MM_PER_PX * v.faceWidth) / 140,
  y: (MM_PER_PX * v.faceHeight) / 120,
  z: (MM_PER_PX * v.earToNoseBridge) / 118,
})

function rawSurface(s: MaskScale, dx: number, py: number): Vec3 {
  const half = smoothTable(HALF_WIDTH, py)
  const over = Math.abs(dx) - half
  const r = Math.min(Math.abs(dx) / half, 1)
  const rim = smoothTable(RIM_DEPTH, py)
  const centre = smoothTable(CENTRE_DEPTH, py)
  // Past the outline the surface keeps turning back, so edge petals wrap instead of folding.
  const z = rim + (centre - rim) * (1 - r ** 2.8) - Math.max(over, 0) * 1.1
  return [dx * s.x, (CENTER_Y - py) * s.y, (z - 165) * s.z]
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** A point on the mask surface, lifted along the local normal, from front-view pixels. */
export function surface(s: MaskScale, px: number, py: number, lift = 0): Vec3 {
  const dx = px - CENTER_X
  const p = rawSurface(s, dx, py)
  if (!lift) return p
  const e = 8
  const ex = rawSurface(s, dx + e, py)
  const ey = rawSurface(s, dx, py + e)
  const ux: Vec3 = [ex[0] - p[0], ex[1] - p[1], ex[2] - p[2]]
  const uy: Vec3 = [ey[0] - p[0], ey[1] - p[1], ey[2] - p[2]]
  const n = unit([ux[2] * uy[1] - ux[1] * uy[2], ux[0] * uy[2] - ux[2] * uy[0], ux[1] * uy[0] - ux[0] * uy[1]])
  const sign = n[2] >= 0 ? 1 : -1
  return [p[0] + n[0] * lift * sign, p[1] + n[1] * lift * sign, p[2] + n[2] * lift * sign]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpPoint = (a: Point, b: Point, t: number): Point => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]

/** An almond with a soft shoulder toward the root, like the petals in the drawing. */
export function petalProfile(u: number) {
  return Math.max(Math.pow(Math.sin(Math.PI * Math.pow(u, 0.86)), 0.72), 0.015)
}

const RETRACTED_LENGTH = 0.56
const RETRACTED_WIDTH = 0.62

export interface PetalPose {
  a: Point
  b: Point
  width: number
  layer: number
}

export function petalPose(config: Config, def: PetalDef, mirrored: boolean, deploy: number): PetalPose {
  const eased = deploy * deploy * (3 - 2 * deploy)
  const a = mirrored ? mirrorPoint(def.a) : def.a
  const fullB = mirrored ? mirrorPoint(def.b) : def.b
  return {
    a,
    b: lerpPoint(a, fullB, lerp(RETRACTED_LENGTH, 1, eased)),
    width: def.width * (config.values.petalScale / 100) * lerp(RETRACTED_WIDTH, 1, eased),
    layer: def.layer,
  }
}

function posePoint(pose: PetalPose, u: number, v: number): Point {
  const dx = pose.b[0] - pose.a[0]
  const dy = pose.b[1] - pose.a[1]
  const length = Math.hypot(dx, dy) || 1
  const half = (petalProfile(u) * v * pose.width) / 2
  return [pose.a[0] + dx * u - (dy / length) * half, pose.a[1] + dy * u + (dx / length) * half]
}

/** Outline samples in drawing pixels, used for the opening check. */
export function poseOutline(pose: PetalPose) {
  const points: Point[] = []
  for (let i = 0; i <= 28; i++) for (const v of [-1, 0, 1]) points.push(posePoint(pose, i / 28, v))
  return points
}

const NU = 30
const NV = 16
const BASE_LIFT = 4
const LAYER_LIFT = 2.1
const DOME = 5.5

function wornPetal(s: MaskScale, config: Config, pose: PetalPose) {
  const th = config.values.petalThickness
  const point = (i: number, j: number, layer: 0 | 1) => {
    const u = i / NU
    const v = (j / NV) * 2 - 1
    const [px, py] = posePoint(pose, u, v)
    const fibre = Math.sin(v * 11 + u * 2) * 0.22 * (1 - v * v)
    const dome = (1 - v * v) * petalProfile(u) * DOME + fibre
    return surface(s, px, py, BASE_LIFT + pose.layer * LAYER_LIFT + dome + (layer ? th : 0))
  }
  return solidGrid(NU, NV, () => true, point, (i, j) => {
    const edge = Math.abs((j / NV) * 2 - 1)
    const u = i / NU
    return Math.min(1, Math.max(edge ** 6, Math.abs(u - 0.5) ** 5 * 22))
  })
}

/** Petals are printed flat; the TPU takes the curve of the mask once mounted. */
export function flatPetal(config: Config, def: PetalDef, s: MaskScale) {
  const length = Math.hypot((def.b[0] - def.a[0]) * s.x, (def.b[1] - def.a[1]) * s.y)
  const width = def.width * s.x * (config.values.petalScale / 100)
  const th = config.values.petalThickness
  return solidGrid(NU, NV, () => true, (i, j, layer) => {
    const u = i / NU
    const v = (j / NV) * 2 - 1
    return [u * length, (petalProfile(u) * v * width) / 2, layer ? th : 0]
  })
}

function closedPath(s: MaskScale, points: Point[], lift: number) {
  const path: Vec3[] = []
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i + points.length - 1) % points.length]
    const p1 = points[i]
    const p2 = points[(i + 1) % points.length]
    const p3 = points[(i + 2) % points.length]
    for (let k = 0; k < 6; k++) {
      const t = k / 6
      const t2 = t * t
      const t3 = t2 * t
      const blend = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
      path.push(surface(s, blend(p0[0], p1[0], p2[0], p3[0]), blend(p0[1], p1[1], p2[1], p3[1]), lift))
    }
  }
  path.push(path[0])
  return path
}

/** The grey carrier: one thin plate following the mask, with bosses that hold each petal. */
export function buildShell(config: Config): Part[] {
  const v = config.values
  const s = maskScale(v)
  const nu = 170
  const nv = 220
  // The grid follows the outline, so the outer edge of the plate stays smooth.
  const py = (j: number) => lerp(70, 806, j / nv)
  const px = (i: number, y: number) => CENTER_X + lerp(-1, 1, i / nu) * (smoothTable(HALF_WIDTH, y) - 14)
  const plate = solidGrid(
    nu,
    nv,
    (i, j) => {
      const y = py(j + 0.5)
      return !OPENINGS.some((o) => insidePolygon(o.points, px(i + 0.5, y), y))
    },
    (i, j, layer) => surface(s, px(i, py(j)), py(j), layer ? v.railWidth / 2 : 0.01),
  )

  const rims = emptyMesh()
  for (const opening of OPENINGS) appendMesh(rims, tube(closedPath(s, opening.points, 1.5), 1.6, 8))

  const bosses = emptyMesh()
  for (const def of PETALS) {
    for (const mirrored of def.centred ? [false] : [false, true]) {
      for (const tip of [def.a, def.b]) {
        const [x, y] = mirrored ? mirrorPoint(tip) : tip
        appendMesh(bosses, sphere(surface(s, x, y, 2.5), 2.4, 6, 12))
      }
    }
  }
  return [
    { name: 'carrier_plate', group: 'rails', material: 'frame', mesh: plate },
    { name: 'opening_rims', group: 'rails', material: 'frame', mesh: rims },
    { name: 'petal_bosses', group: 'rails', material: 'frame', mesh: bosses },
  ]
}

function earHook(config: Config, side: Side) {
  const v = config.values
  const s = maskScale(v)
  const start = surface(s, CENTER_X + side * 292, 420, 0)
  const radius = v.earHeight * 0.5
  const hook: Vec3[] = []
  for (let i = 0; i <= 24; i++) {
    const t = lerp(-10, 215, i / 24) * (Math.PI / 180)
    hook.push([
      start[0] + side * (Math.sin(t) * 3 + 2),
      start[1] + Math.sin(t) * radius,
      start[2] - radius * 1.1 + Math.cos(t) * radius,
    ])
  }
  return tube(hook, v.earHookWidth / 2, 10)
}

export function zoneDeploy(config: Config, state: WearState, region: Region): Record<ZoneId, number> {
  const out = {} as Record<ZoneId, number>
  for (const zone of ZONES) {
    const enabled = zone.id === 'Z5' ? config.shadeDeployed : config.enabledZones.includes(zone.id)
    const wanted =
      zone.id === 'Z5'
        ? state !== 'standby'
        : state === 'full' || (state === 'adaptive' && zone.region === region)
    out[zone.id] = enabled && wanted ? 1 : 0
  }
  return out
}

export interface BuildOptions {
  deploy: Record<ZoneId, number>
}

/** Builds the moving parts as worn. The fixed carrier comes from buildShell. */
export function buildWorn(config: Config, options: BuildOptions): Part[] {
  const v = config.values
  const s = maskScale(v)
  const parts: Part[] = []

  for (const side of [1, -1] as Side[]) {
    const tag = side === 1 ? 'L' : 'R'
    parts.push({ name: `ear_hook_${tag}`, group: 'ear', material: 'frame', mesh: earHook(config, side) })
  }

  for (const def of PETALS) {
    const variants: { mirrored: boolean; side: Side; tag: string }[] = def.centred
      ? [{ mirrored: false, side: 1, tag: 'C' }]
      : [
          { mirrored: true, side: 1, tag: 'L' },
          { mirrored: false, side: -1, tag: 'R' },
        ]
    for (const { mirrored, side, tag } of variants) {
      const pose = petalPose(config, def, mirrored, options.deploy[def.zone])
      parts.push({
        name: `petal_${def.id}_${tag}`,
        group: 'petals',
        material: 'petal',
        zone: def.zone,
        side,
        mesh: wornPetal(s, config, pose),
      })
      if (def.zone !== 'Z5') {
        // The contact node sits on the skin side of the carrier, under the middle of the petal.
        const [x, y] = posePoint(pose, 0.5, 0)
        parts.push({
          name: `node_${def.id}_${tag}`,
          group: 'rails',
          material: 'node',
          zone: def.zone,
          side,
          mesh: sphere(surface(s, x, y, -v.nodeDiameter / 2), v.nodeDiameter / 2, 6, 12),
        })
      }
    }
  }
  return parts
}

export function petalCount() {
  return PETALS.reduce((sum, p) => sum + (p.centred ? 1 : 2), 0)
}

/** Printable parts: flat petals plus the rigid carrier in its worn shape. */
export function buildPrintParts(config: Config): Part[] {
  const s = maskScale(config.values)
  const petals: Part[] = []
  for (const def of PETALS) {
    for (const tag of def.centred ? ['C'] : ['L', 'R']) {
      petals.push({
        name: `petal_${def.id}_${tag}`,
        group: 'petals',
        material: 'petal',
        zone: def.zone,
        mesh: flatPetal(config, def, s),
      })
    }
  }
  const hooks = ([1, -1] as Side[]).map(
    (side): Part => ({
      name: `ear_hook_${side === 1 ? 'L' : 'R'}`,
      group: 'ear',
      material: 'frame',
      mesh: earHook(config, side),
    }),
  )
  return [...petals, ...buildShell(config), ...hooks]
}

export const PETAL_CENTERS: Record<ZoneId, Point> = Object.fromEntries(
  ZONES.map((z) => {
    const def = PETALS.find((p) => p.zone === z.id)!
    return [z.id, lerpPoint(def.a, def.b, 0.5)]
  }),
) as Record<ZoneId, Point>
