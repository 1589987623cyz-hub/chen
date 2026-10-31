import * as THREE from 'three'
import contactsJson from '@exsense/contacts.json'
import params from '@exsense/params.json'
import pinsJson from '@exsense/pins.json'
import { buildContactGeometry, buildSensorGeometry, buildTileGeometry, holeDistance, makeShell } from '@exsense/reference/maskGeometry.js'
import sensorsJson from '@exsense/sensors.json'
import tilesJson from '@exsense/tiles.json'
import type { Sector, ZoneId } from '@/domain/params'
import { solidGrid, tube, weld, type Mesh, type Vec3 } from './mesh'

export type PartGroup = 'tiles' | 'shell' | 'pins' | 'sensors' | 'contacts'

export interface Part {
  name: string
  group: PartGroup
  mesh: Mesh
}

type Point = [number, number]

export interface Tile {
  id: string
  centroidUV: Point
  centroid2D: Point
  centroid3D: Vec3
  normal: Vec3
  areaUV: number
  sector: Sector
  zone: ZoneId
  outlineUV: Point[]
  anchorUV: Point | null
  row: number
  /** Each petal lying under this one, and how far this one can go in on its own before touching it. */
  beneath: [string, number][]
  petal: Petal
}

export interface Petal {
  uv: number[]
  off: number[]
  rank: number
  tint: number
  size: number
}

export interface Pin {
  id: string
  base3D: Vec3
  normal: Vec3
  uv: Point
}

export interface Sensor {
  id: string
  kind: 'space' | 'uv' | 'air'
  name: string
  uv: Point
  p2D: Point
  base3D: Vec3
  normal: Vec3
  facingDeg: number
}

export interface Contact {
  id: string
  tile: string
  uv: Point
  sector: Sector
  zone: ZoneId
  base3D: Vec3
  axis: Vec3
  length: number
  padRadius: number
  thermal: boolean
  reach: number
}

// All geometry comes from the generated files. To change the shape, edit exsense/generate.py.
export const maskParams = params
export const tiles = tilesJson.tiles as unknown as Tile[]
export const pins = pinsJson.pins as unknown as Pin[]
export const sensors = sensorsJson.sensors as unknown as Sensor[]
export const contacts = contactsJson.contacts as unknown as Contact[]
export const shell = makeShell(params)

export function geometryToMesh(geometry: THREE.BufferGeometry): Mesh {
  return weld({
    positions: Array.from(geometry.attributes.position.array),
    indices: Array.from(geometry.index!.array),
  })
}

export const tileMesh = (tile: Tile) => geometryToMesh(buildTileGeometry(tile, params, shell))
export const contactMesh = (contact: Contact) => geometryToMesh(buildContactGeometry(contact, params))
export const sensorMesh = (sensor: Sensor) => geometryToMesh(buildSensorGeometry(sensor, params).collar)

export const insidePolygon = (points: Point[], x: number, y: number) => {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const polygonArea = (points: Point[]) =>
  Math.abs(
    points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length]
      return sum + x * ny - nx * y
    }, 0),
  ) / 2

const openings = Object.values(params.outlines.openingsUV) as Point[][]
export const openingOutlines = openings
const holes = params.outlines.holesUV as [number, number, number, number, number][]

/** A printable solid of the shell. The preview cuts the same outline with an alpha map instead. */
export function shellMesh(nu = 260, nv = 320): Mesh {
  const { U_MAX, V_MIN, V_MAX } = params.derived
  const trim = params.outlines.trimUV as Point[]
  const uAt = (i: number) => -U_MAX + (2 * U_MAX * i) / nu
  const vAt = (j: number) => V_MIN + ((V_MAX - V_MIN) * j) / nv
  const filled: boolean[][] = []
  for (let i = 0; i < nu; i++) {
    filled.push([])
    for (let j = 0; j < nv; j++) {
      const u = uAt(i + 0.5)
      const v = vAt(j + 0.5)
      filled[i].push(
        insidePolygon(trim, u, v) && !openings.some((o) => insidePolygon(o, u, v)) && !holes.some((h) => holeDistance(u, v, h) < 0),
      )
    }
  }
  // Cells that touch only at a corner would make the printed part non-manifold.
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      const a = filled[i][j]
      if (a === filled[i + 1][j + 1] && filled[i + 1][j] === filled[i][j + 1] && a !== filled[i + 1][j]) {
        filled[i][j] = filled[i + 1][j] = filled[i][j + 1] = filled[i + 1][j + 1] = true
      }
    }
  }
  const point = new THREE.Vector3()
  return solidGrid(nu, nv, (i, j) => filled[i][j], (i, j, layer) => {
    shell.uvTo3D(uAt(i), vAt(j), layer ? 0 : -params.shell.thickness, point)
    return [point.x, point.y, point.z]
  })
}

export function pinMesh(pin: Pin): Mesh {
  const { radius, height } = params.pins
  const [x, y, z] = pin.base3D
  const [nx, ny, nz] = pin.normal
  return tube([[x, y, z], [x + nx * height, y + ny * height, z + nz * height]], radius, 20)
}

/** Every part at its rest position, ready for print and CAD export. */
export function buildParts(): Part[] {
  return [
    { name: 'shell', group: 'shell', mesh: shellMesh() },
    ...tiles.map((tile): Part => ({ name: tile.id, group: 'tiles', mesh: tileMesh(tile) })),
    ...pins.map((pin): Part => ({ name: pin.id, group: 'pins', mesh: pinMesh(pin) })),
    ...sensors.map((sensor): Part => ({ name: sensor.id, group: 'sensors', mesh: sensorMesh(sensor) })),
    ...contacts.map((contact): Part => ({ name: contact.id, group: 'contacts', mesh: contactMesh(contact) })),
  ]
}

/** The tiles of a zone plus their direct lattice neighbours. */
export function zoneWithNeighbours(zone: ZoneId) {
  const core = tiles.filter((t) => t.zone === zone)
  const reach = Math.hypot(params.tiles.latticeDiagU, params.tiles.latticeDiagV) / 2 + 2
  return tiles.filter(
    (t) =>
      t.zone === zone ||
      core.some((c) => Math.hypot(c.centroidUV[0] - t.centroidUV[0], c.centroidUV[1] - t.centroidUV[1]) < reach),
  )
}
