export type Mode = 'simple' | 'pro'
export type ParamGroup = 'measure' | 'feedback'

export interface NumericParam<K extends string = string> {
  key: K
  unit: string
  min: number
  max: number
  def: number
  step: number
  mode: Mode
  group: ParamGroup
}

const p = <const K extends string>(
  key: K,
  unit: string,
  min: number,
  max: number,
  def: number,
  step: number,
  mode: Mode,
  group: ParamGroup,
): NumericParam<K> => ({ key, unit, min, max, def, step, mode, group })

// Ranges are the initial values from PLAN.md; they still need physical calibration.
export const NUMERIC_PARAMS = [
  p('headCircumference', 'mm', 500, 620, 560, 1, 'simple', 'measure'),
  p('faceWidth', 'mm', 120, 160, 140, 1, 'simple', 'measure'),
  p('faceHeight', 'mm', 100, 140, 120, 1, 'simple', 'measure'),
  p('earToNoseBridge', 'mm', 100, 135, 118, 1, 'simple', 'measure'),
  p('earToChin', 'mm', 120, 160, 140, 1, 'simple', 'measure'),
  p('pupilDistance', 'mm', 54, 74, 64, 1, 'simple', 'measure'),
  p('earHeight', 'mm', 50, 75, 62, 1, 'simple', 'measure'),
  p('earBackGap', 'mm', 5, 20, 12, 1, 'simple', 'measure'),

  p('pmThreshold', 'µg/m³', 15, 150, 75, 1, 'simple', 'feedback'),
  p('uvThreshold', 'UVI', 3, 11, 6, 1, 'simple', 'feedback'),
  p('hapticLevel', 'level', 1, 5, 3, 1, 'simple', 'feedback'),
  p('thermalLevel', 'level', 1, 3, 2, 1, 'simple', 'feedback'),
  p('cueDuration', 's', 1, 5, 2, 0.5, 'simple', 'feedback'),
  p('distanceFar', 'm', 1, 3, 2, 0.1, 'pro', 'feedback'),
  p('distanceMid', 'm', 0.5, 1.5, 1, 0.1, 'pro', 'feedback'),
  p('distanceNear', 'm', 0.3, 1, 0.5, 0.1, 'pro', 'feedback'),
  p('pulseSlow', 'Hz', 1, 3, 2, 0.5, 'pro', 'feedback'),
  p('pulseFast', 'Hz', 3, 8, 5, 0.5, 'pro', 'feedback'),
] as const

export type NumericKey = (typeof NUMERIC_PARAMS)[number]['key']
export type NumericValues = Record<NumericKey, number>

export const paramByKey = Object.fromEntries(NUMERIC_PARAMS.map((x) => [x.key, x])) as Record<
  NumericKey,
  NumericParam
>

export type SizePreset = 'S' | 'M' | 'L'

export const SIZE_PRESETS: Record<SizePreset, Partial<NumericValues>> = {
  S: {
    headCircumference: 530,
    faceWidth: 130,
    faceHeight: 110,
    earToNoseBridge: 110,
    earToChin: 130,
    pupilDistance: 60,
    earHeight: 56,
    earBackGap: 10,
  },
  M: {
    headCircumference: 560,
    faceWidth: 140,
    faceHeight: 120,
    earToNoseBridge: 118,
    earToChin: 140,
    pupilDistance: 64,
    earHeight: 62,
    earBackGap: 12,
  },
  L: {
    headCircumference: 590,
    faceWidth: 150,
    faceHeight: 130,
    earToNoseBridge: 126,
    earToChin: 150,
    pupilDistance: 68,
    earHeight: 68,
    earBackGap: 14,
  },
}

// Zones and sectors come from exsense/SPEC.md section 5.
export const ZONE_IDS = ['forehead', 'centre', 'temple_L', 'temple_R', 'cheek_L', 'cheek_R', 'chin'] as const
export type ZoneId = (typeof ZONE_IDS)[number]

export const SECTORS = ['top', 'upperRight', 'right', 'lowerRight', 'bottom', 'lowerLeft', 'left', 'upperLeft'] as const
export type Sector = (typeof SECTORS)[number]

export type PrintPreset = 'fdm' | 'service'

export interface Cues {
  space: boolean
  air: boolean
  uv: boolean
  thermal: boolean
  tap: boolean
}

export interface Config {
  schemaVersion: 2
  id: string
  name: string
  updatedAt: string
  mode: Mode
  sizePreset: SizePreset | 'custom'
  values: NumericValues
  enabledZones: ZoneId[]
  cues: Cues
  hapticByZone: Partial<Record<ZoneId, number>>
  printPreset: PrintPreset
  /** Set only when the wearer has personally confirmed the feedback settings. */
  feedbackConfirmed: boolean
}

export const CONFIG_SCHEMA_VERSION = 2

export function defaultValues(size: SizePreset = 'M'): NumericValues {
  const base = Object.fromEntries(NUMERIC_PARAMS.map((x) => [x.key, x.def])) as NumericValues
  return { ...base, ...SIZE_PRESETS[size] }
}

export function createConfig(name: string, id: string = crypto.randomUUID()): Config {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    id,
    name,
    updatedAt: new Date().toISOString(),
    mode: 'simple',
    sizePreset: 'M',
    values: defaultValues('M'),
    enabledZones: [...ZONE_IDS],
    cues: { space: true, air: true, uv: true, thermal: true, tap: true },
    hapticByZone: {},
    printPreset: 'fdm',
    feedbackConfirmed: false,
  }
}

/** Fields only the wearer may change; a collaborator edit must leave them as they are. */
export function feedbackFields(config: Config) {
  const feedbackKeys = NUMERIC_PARAMS.filter((x) => x.group === 'feedback').map((x) => x.key)
  return {
    values: Object.fromEntries(feedbackKeys.map((k) => [k, config.values[k]])),
    cues: config.cues,
    hapticByZone: config.hapticByZone,
    feedbackConfirmed: config.feedbackConfirmed,
  }
}

export function parseConfig(text: string): Config {
  const raw = JSON.parse(text) as Omit<Partial<Config>, 'schemaVersion'> & { schemaVersion?: number }
  if (raw?.schemaVersion !== 1 && raw?.schemaVersion !== CONFIG_SCHEMA_VERSION) throw new Error('schema')
  const base = createConfig(raw.name ?? 'Imported', raw.id ?? crypto.randomUUID())
  const known = Object.fromEntries(Object.entries(raw.values ?? {}).filter(([key]) => key in base.values))
  const values = { ...base.values, ...known }
  // Version 1 described the earlier petal models, so only the wearer's own data carries over.
  if (raw.schemaVersion === 1) {
    return { ...base, updatedAt: raw.updatedAt ?? base.updatedAt, mode: raw.mode ?? base.mode, sizePreset: raw.sizePreset ?? base.sizePreset, values, cues: { ...base.cues, ...raw.cues } }
  }
  return { ...base, ...raw, schemaVersion: CONFIG_SCHEMA_VERSION, values, cues: { ...base.cues, ...raw.cues } }
}
