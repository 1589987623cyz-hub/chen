import * as THREE from 'three'
import type { Config, Sector } from '@/domain/params'
import { maskParams, tiles, zoneWithNeighbours, type Tile } from '@/geometry/mask'

export type MaskState = { kind: 'rest' } | { kind: 'space'; sector: Sector } | { kind: 'air' } | { kind: 'uv' }

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
}

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
    const list = tiles.filter((t) => t.sector === state.sector && config.enabledZones.includes(t.zone))
    const centre: [number, number] = [0, maskParams.openings.eyes.cy]
    for (const [tile, color] of byDistance(list, centre, HEAT)) {
      out.set(tile.id, { travel: maskParams.tiles.travelIn, color, pulses: false })
    }
  }
  if (state.kind === 'air') {
    const color = new THREE.Color('#6fb3ff')
    for (const tile of zoneWithNeighbours('cheek_R')) out.set(tile.id, { travel: 0, color, pulses: true })
  }
  if (state.kind === 'uv') {
    const list = zoneWithNeighbours('cheek_L')
    const cx = list.reduce((sum, t) => sum + t.centroid2D[0], 0) / list.length
    const cy = list.reduce((sum, t) => sum + t.centroid2D[1], 0) / list.length
    const warm = [new THREE.Color('#ff4a2a'), new THREE.Color('#ffd23a')]
    for (const [tile, color] of byDistance(list, [cx, cy], warm)) {
      out.set(tile.id, { travel: 0, color, pulses: true })
    }
  }
  return out
}
