import { clearAperture, insidePolygon, maskScale, OPENINGS, petalPose, PETALS, poseOutline } from '@/geometry/mask'
import { NUMERIC_PARAMS, TACTILE_ZONE_IDS, type Config, type NumericKey, type PrintPreset } from './params'

export interface Issue {
  severity: 'error' | 'warning'
  code: string
  field?: NumericKey
  args?: Record<string, string | number>
}

export const PRINT_RULES: Record<PrintPreset, { minPetalThickness: number; minFrameWidth: number }> = {
  fdm: { minPetalThickness: 1, minFrameWidth: 2.5 },
  service: { minPetalThickness: 0.8, minFrameWidth: 1.5 },
}

const MAX_SIDE_MASS_G = 50
const DESIGN_EYE_SPACING = 61

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
  if (config.zoneMap.Z5) error('shadeMapped')
  const hasSpaceZone = config.enabledZones.some((z) => TACTILE_ZONE_IDS.includes(z) && config.zoneMap[z])
  if (config.cues.space && !hasSpaceZone) error('noActiveZone')
  for (const z of config.enabledZones) {
    if (z !== 'Z5' && !config.zoneMap[z]) error('unmappedZone', undefined, { zone: z })
  }

  const rules = PRINT_RULES[config.printPreset]
  if (v.petalThickness < rules.minPetalThickness) {
    error('printThickness', 'petalThickness', { min: rules.minPetalThickness })
  }
  if (v.railWidth < rules.minFrameWidth) error('printRail', 'railWidth', { min: rules.minFrameWidth })

  // Petals have to stay clear of the openings for the whole motion, not only at rest.
  const intruded = new Set<string>()
  for (const def of PETALS) {
    for (const mirrored of def.centred ? [false] : [false, true]) {
      for (let step = 0; step <= 4; step++) {
        const outline = poseOutline(petalPose(config, def, mirrored, step / 4))
        for (const opening of OPENINGS) {
          const aperture = clearAperture(opening.points)
          if (outline.some(([x, y]) => insidePolygon(aperture, x, y))) {
            intruded.add(`${def.zone}:${opening.id}`)
          }
        }
      }
    }
  }
  for (const item of intruded) {
    const [part, zone] = item.split(':')
    error('openZone', undefined, { part, zone })
  }

  const eyeSpacing = (DESIGN_EYE_SPACING * v.faceWidth) / 140
  if (Math.abs(eyeSpacing - v.pupilDistance) > 10) {
    issues.push({ severity: 'warning', code: 'eyeSpacing', args: { value: Math.round(eyeSpacing) } })
  }
  if (estimateSideMass(config) > MAX_SIDE_MASS_G) {
    issues.push({ severity: 'warning', code: 'heavy', args: { max: MAX_SIDE_MASS_G } })
  }
  if (!config.feedbackConfirmed) issues.push({ severity: 'warning', code: 'unconfirmed' })
  return issues
}

/** Rough printed mass of one side in grams, excluding electronics. */
export function estimateSideMass(config: Config) {
  const v = config.values
  const s = maskScale(v)
  const scale = v.petalScale / 100
  let petals = 0
  for (const p of PETALS) {
    const length = Math.hypot((p.b[0] - p.a[0]) * s.x, (p.b[1] - p.a[1]) * s.y)
    petals += (0.68 * length * p.width * s.x * scale * v.petalThickness) * (p.centred ? 0.5 : 1)
  }
  const plate = 0.5 * 0.62 * Math.PI * 76 * 98 * 1.25 * (v.railWidth / 2.5)
  return (petals * 1.21 + plate * 1.24) / 1000
}

export const hasBlockingIssue = (issues: Issue[]) => issues.some((i) => i.severity === 'error')
