import { maskParams, openingOutlines, pins, polygonArea, tiles } from '@/geometry/mask'
import { NUMERIC_PARAMS, type Config, type NumericKey } from './params'

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
  if (issues.length) return issues

  if (!(v.distanceNear < v.distanceMid && v.distanceMid < v.distanceFar)) error('distanceOrder', 'distanceMid')
  if (!(v.pulseSlow < v.pulseFast)) error('pulseOrder', 'pulseFast')
  if (!config.cues.thermal && !config.cues.tap) error('noCue')
  if (config.cues.space && !config.enabledZones.length) error('noActiveZone')

  if (Math.abs(EYE_SPACING_MM - v.pupilDistance) > EYE_SPACING_TOLERANCE_MM) {
    issues.push({ severity: 'warning', code: 'eyeSpacing', field: 'pupilDistance', args: { value: EYE_SPACING_MM } })
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
  return ((tileVolume + shellVolume + pinVolume) * PRINT_DENSITY) / 1000
}

export const hasBlockingIssue = (issues: Issue[]) => issues.some((i) => i.severity === 'error')
