import { ZONES, type Config, type Direction, type Height, type ZoneId } from '@/domain/params'
import type { Side, WearState } from '@/geometry/mask'

export interface Obstacle {
  direction: Direction
  height: Height
  side: 'left' | 'right'
  distance: number
}

export type Tier = 'none' | 'slow' | 'fast' | 'hold'

export interface SpaceResult {
  tier: Tier
  pulseHz: number
  zones: { zone: ZoneId; side: Side }[]
  /** Set in standby, when only the ear hub can report a straight-ahead obstacle. */
  earOnly: boolean
  blockedByState: boolean
}

export function distanceTier(config: Config, distance: number): Tier {
  const v = config.values
  if (distance > v.distanceFar) return 'none'
  if (distance > v.distanceMid) return 'slow'
  if (distance > v.distanceNear) return 'fast'
  return 'hold'
}

export function simulateObstacle(
  config: Config,
  obstacle: Obstacle,
  state: WearState,
  deploy: Record<ZoneId, number>,
): SpaceResult {
  const v = config.values
  const tier = config.cues.space ? distanceTier(config, obstacle.distance) : 'none'
  const pulseHz = tier === 'slow' ? v.pulseSlow : tier === 'fast' ? v.pulseFast : 0
  const empty = { tier, pulseHz, zones: [], earOnly: false, blockedByState: false }
  if (tier === 'none') return empty
  if (state === 'standby') {
    return obstacle.direction === 'front' ? { ...empty, earOnly: true } : { ...empty, blockedByState: true }
  }
  const side: Side = obstacle.side === 'left' ? 1 : -1
  const sides: Side[] = obstacle.direction === 'front' ? [1, -1] : [side]
  const matches = ZONES.filter((z) => {
    const map = config.zoneMap[z.id]
    if (!map || !config.enabledZones.includes(z.id) || deploy[z.id] === 0) return false
    if (map.nearOnly && tier !== 'hold') return false
    return map.direction === obstacle.direction && map.heights.includes(obstacle.height)
  })
  if (!matches.length) return { ...empty, blockedByState: true }
  return { ...empty, zones: matches.flatMap((z) => sides.map((s) => ({ zone: z.id, side: s }))) }
}
