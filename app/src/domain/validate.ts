import { heldBack } from '@/scene/feedback'
import { contacts, maskParams, openingOutlines, pins, polygonArea, sensors, tiles } from '@/geometry/mask'
import { NUMERIC_PARAMS, SECTORS, TRAVEL_RANGE, type Config, type NumericKey } from './params'

export interface Issue {
  severity: 'error' | 'warning'
  code: string
  field?: NumericKey
  args?: Record<string, string | number>
}

const MAX_PRINT_MASS_G = 100
const PRINT_DENSITY = 1.24
const EYE_SPACING_MM = maskParams.openings.eyes.cx * 2
const EYE_SPACING_TOLERANCE_MM = 8
export const MIN_ACTIVE_PETALS = 3

/** Directions left with too few moving petals to feel, after zones and muted petals are taken out. */
export function weakSectors(config: Config) {
  return SECTORS.filter((sector) => {
    const live = tiles.filter((t) => t.sector === sector && config.enabledZones.includes(t.zone) && !config.motion.muted.includes(t.id))
    return live.length < MIN_ACTIVE_PETALS
  })
}

/** Professional settings that keep working while simple mode hides their controls. */
export function hiddenProSettings(config: Config) {
  const { motion, look, hapticByZone, values } = config
  const counts = [motion.zoneTravel, look.zonePalette, look.zoneBloom, hapticByZone].map((map) => Object.keys(map).length)
  const distances = NUMERIC_PARAMS.filter((p) => p.mode === 'pro' && values[p.key] !== p.def).length
  return counts.reduce((sum, n) => sum + n, distances) + (motion.pattern === 'together' ? 0 : 1)
}

export function validate(config: Config): Issue[] {
  const v = config.values
  const issues: Issue[] = []
  const error = (code: string, field?: NumericKey, args?: Issue['args']) =>
    issues.push({ severity: 'error', code, field, args })

  for (const p of NUMERIC_PARAMS) {
    const value = v[p.key]
    if (!Number.isFinite(value) || value < p.min || value > p.max) {
      error('range', p.key, { min: p.min, max: p.max, unit: p.unit })
    }
  }
  const { travel, muted } = config.motion
  const inRange = (mm: number) => mm >= TRAVEL_RANGE.min && mm <= TRAVEL_RANGE.max
  if (![travel, ...Object.values(config.motion.zoneTravel)].every(inRange)) error('travelRange', undefined, { min: TRAVEL_RANGE.min, max: TRAVEL_RANGE.max })
  if (issues.length) return issues

  if (!(v.distanceNear < v.distanceMid && v.distanceMid < v.distanceFar)) error('distanceOrder', 'distanceMid')
  if (!(v.pulseSlow < v.pulseFast)) error('pulseOrder', 'pulseFast')
  if (!config.cues.thermal && !config.cues.tap) error('noCue')
  if (config.cues.space && !config.enabledZones.length) error('noActiveZone')

  if (Math.abs(EYE_SPACING_MM - v.pupilDistance) > EYE_SPACING_TOLERANCE_MM) {
    issues.push({ severity: 'warning', code: 'eyeSpacing', field: 'pupilDistance', args: { value: EYE_SPACING_MM } })
  }
  const quiet = weakSectors(config)
  if (config.cues.space && quiet.length) issues.push({ severity: 'warning', code: 'weakSector', args: { n: quiet.length, min: MIN_ACTIVE_PETALS } })
  if (travel - maskParams.contacts.tipGap < 0.3) issues.push({ severity: 'warning', code: 'lightPress', args: { mm: Number((travel - maskParams.contacts.tipGap).toFixed(1)) } })
  if (muted.length) issues.push({ severity: 'warning', code: 'muted', args: { n: muted.length } })
  if (config.cues.space) {
    const held = SECTORS.reduce((sum, sector) => sum + heldBack(config, sector), 0)
    if (held) issues.push({ severity: 'warning', code: 'heldBack', args: { n: held } })
  }
  if (estimateMass() > MAX_PRINT_MASS_G) {
    issues.push({ severity: 'warning', code: 'heavy', args: { max: MAX_PRINT_MASS_G } })
  }
  if (!config.feedbackConfirmed) issues.push({ severity: 'warning', code: 'unconfirmed' })
  return issues
}

/** Rough printed mass in grams, excluding electronics and straps. */
export function estimateMass() {
  const tileVolume = tiles.reduce((sum, t) => sum + t.areaUV * maskParams.tiles.thickness, 0)
  const trimmed = polygonArea(maskParams.outlines.trimUV as [number, number][])
  const open = openingOutlines.reduce((sum, outline) => sum + polygonArea(outline), 0)
  const shellVolume = (trimmed - open) * maskParams.shell.thickness
  const pinVolume = pins.length * Math.PI * maskParams.pins.radius ** 2 * maskParams.pins.height
  const { collarRadius, collarTop, backOffset } = maskParams.sensors
  const sensorVolume = sensors.length * Math.PI * collarRadius ** 2 * (collarTop - backOffset)
  const contactVolume = contacts.reduce((sum, c) => {
    const { stemRadius, padHeight } = maskParams.contacts
    return sum + Math.PI * (stemRadius ** 2 * c.length + c.padRadius ** 2 * padHeight)
  }, 0)
  return ((tileVolume + shellVolume + pinVolume + sensorVolume + contactVolume) * PRINT_DENSITY) / 1000
}

export const hasBlockingIssue = (issues: Issue[]) => issues.some((i) => i.severity === 'error')
