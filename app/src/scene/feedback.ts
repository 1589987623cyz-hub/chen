import * as THREE from 'three'
import type { Config, Sector } from '@/domain/params'
import { maskParams, tiles, zoneWithNeighbours, type Tile } from '@/geometry/mask'

export type MaskState = { kind: 'rest' } | { kind: 'space'; sector: Sector } | { kind: 'air' } | { kind: 'uv' }
export const REST: MaskState = { kind: 'rest' }

export type SimulationKind = MaskState['kind']

export interface Simulation {
  kind: SimulationKind
  sector: Sector
  distance: number
  pm: number
  uv: number
}

export type Tier = 'none' | 'slow' | 'fast' | 'hold'

export function distanceTier(config: Config, distance: number): Tier {
  const v = config.values
  if (distance > v.distanceFar) return 'none'
  if (distance > v.distanceMid) return 'slow'
  if (distance > v.distanceNear) return 'fast'
  return 'hold'
}

export interface SimulationResult {
  state: MaskState
  tier: Tier
  pulseHz: number
  tileCount: number
}

/** Decides what the mask does for a simulated reading, from the wearer's own settings. */
export function resolveSimulation(config: Config, sim: Simulation): SimulationResult {
  const v = config.values
  const rest: SimulationResult = { state: { kind: 'rest' }, tier: 'none', pulseHz: 0, tileCount: 0 }
  if (sim.kind === 'space') {
    const tier = config.cues.space ? distanceTier(config, sim.distance) : 'none'
    if (tier === 'none') return rest
    const state: MaskState = { kind: 'space', sector: sim.sector }
    const pulseHz = tier === 'slow' ? v.pulseSlow : tier === 'fast' ? v.pulseFast : 0
    return { state, tier, pulseHz, tileCount: tileFeedback(config, state).size }
  }
  if (sim.kind === 'air' && config.cues.air && sim.pm >= v.pmThreshold) {
    const state: MaskState = { kind: 'air' }
    return { ...rest, state, tileCount: tileFeedback(config, state).size }
  }
  if (sim.kind === 'uv' && config.cues.uv && sim.uv >= v.uvThreshold) {
    const state: MaskState = { kind: 'uv' }
    return { ...rest, state, tileCount: tileFeedback(config, state).size }
  }
  return rest
}

export interface TileFeedback {
  travel: number
  color: THREE.Color
  pulses: boolean
  /** Seconds after the cue starts. */
  delay: number
}

/** The travel a petal is set to, from its zone or the overall setting. */
export const wantedTravel = (config: Config, tile: Tile) => config.motion.zoneTravel[tile.zone] ?? config.motion.travel

const byRank = [...tiles].sort((a, b) => a.petal.rank - b.petal.rank)
const tileById = new Map(tiles.map((t) => [t.id, t]))

/**
 * How far each moving petal can really go. A petal can only sink into the room left above the petals under it,
 * so one that moves further than its neighbour beneath is held back. Worked from the bottom of the stack up.
 */
export function limitTravel(wanted: Map<string, number>) {
  const done = new Map<string, number>()
  for (const tile of byRank) {
    const want = wanted.get(tile.id)
    if (want === undefined) continue
    let limit = want
    for (const [id, gap] of tile.beneath) limit = Math.min(limit, (done.get(id) ?? 0) + gap)
    done.set(tile.id, Math.max(0, Math.round(limit * 100) / 100))
  }
  return done
}

/** Travel for one petal or a group moved on their own, as the test buttons do. */
export function pressTravel(config: Config, ids: string[]) {
  return limitTravel(new Map(ids.map((id) => [id, wantedTravel(config, tileById.get(id)!)])))
}

/** Petals that cannot reach their full travel in the cue for a direction. */
export function heldBack(config: Config, sector: Sector) {
  const list = liveTiles(config, sector)
  const done = limitTravel(new Map(list.map((t) => [t.id, wantedTravel(config, t)])))
  return list.filter((t) => done.get(t.id)! < wantedTravel(config, t) - 0.01).length
}

const liveTiles = (config: Config, sector: Sector) =>
  tiles.filter((t) => t.sector === sector && config.enabledZones.includes(t.zone) && !config.motion.muted.includes(t.id))

const HEAT = ['#2f7bff', '#27c7e8', '#3fe08a', '#ffd23a'].map((c) => new THREE.Color(c))

function ramp(stops: THREE.Color[], t: number) {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1)
  const i = Math.min(Math.floor(x), stops.length - 2)
  return stops[i].clone().lerp(stops[i + 1], x - i)
}

function byDistance(list: Tile[], centre: [number, number], stops: THREE.Color[]) {
  const distance = (t: Tile) => Math.hypot(t.centroid2D[0] - centre[0], t.centroid2D[1] - centre[1])
  const values = list.map(distance)
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  return new Map(list.map((t) => [t, ramp(stops, (distance(t) - min) / span)]))
}

/** Per-tile response for a state. Thermal colours are illustrative, as in SPEC section 6. */
export function tileFeedback(config: Config, state: MaskState): Map<string, TileFeedback> {
  const out = new Map<string, TileFeedback>()
  if (state.kind === 'space') {
    const list = liveTiles(config, state.sector)
    const centre: [number, number] = [0, maskParams.openings.eyes.cy]
    const travel = limitTravel(new Map(list.map((t) => [t.id, wantedTravel(config, t)])))
    // Petals lower in the stack go first, so a petal never presses on one that has not moved yet.
    const order = [...list].sort((a, b) => a.petal.rank - b.petal.rank).map((t) => t.id)
    const step = config.motion.pattern === 'cascade' ? config.motion.stepMs / 1000 : 0
    for (const [tile, color] of byDistance(list, centre, HEAT)) {
      out.set(tile.id, { travel: travel.get(tile.id)!, color, pulses: false, delay: order.indexOf(tile.id) * step })
    }
  }
  if (state.kind === 'air') {
    const color = new THREE.Color('#6fb3ff')
    for (const tile of zoneWithNeighbours('cheek_R')) out.set(tile.id, { travel: 0, color, pulses: true, delay: 0 })
  }
  if (state.kind === 'uv') {
    const list = zoneWithNeighbours('cheek_L')
    const cx = list.reduce((sum, t) => sum + t.centroid2D[0], 0) / list.length
    const cy = list.reduce((sum, t) => sum + t.centroid2D[1], 0) / list.length
    const warm = [new THREE.Color('#ff4a2a'), new THREE.Color('#ffd23a')]
    for (const [tile, color] of byDistance(list, [cx, cy], warm)) {
      out.set(tile.id, { travel: 0, color, pulses: true, delay: 0 })
    }
  }
  return out
}
