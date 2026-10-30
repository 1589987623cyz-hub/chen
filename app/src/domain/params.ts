export type Mode = 'simple' | 'pro'
export type ParamGroup = 'measure' | 'fit' | 'petal' | 'rail' | 'feedback'

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

  p('earHookWidth', 'mm', 4, 10, 4, 0.5, 'pro', 'fit'),
  p('earHookPadThickness', 'mm', 1, 4, 2, 0.5, 'pro', 'fit'),

  p('petalScale', '%', 80, 130, 100, 1, 'pro', 'petal'),
  p('petalThickness', 'mm', 0.8, 2, 1, 0.1, 'pro', 'petal'),

  p('railWidth', 'mm', 1.5, 5, 2.5, 0.5, 'pro', 'rail'),
  p('nodeDiameter', 'mm', 4, 10, 4, 0.5, 'pro', 'rail'),
  p('nodeTravel', 'mm', 0.5, 3, 1.5, 0.1, 'pro', 'rail'),

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

export type ZoneId = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'Z6' | 'Z7' | 'Z8' | 'Z9' | 'Z10'
export type Direction = 'front' | 'diagonal' | 'side'
export type Height = 'head' | 'chest' | 'waist'
export type Region = 'upper' | 'middle' | 'lower'

export interface ZoneDef {
  id: ZoneId
  rail: 'upper' | 'lower'
  region: Region
}

export const ZONES: ZoneDef[] = [
  { id: 'Z1', rail: 'upper', region: 'upper' },
  { id: 'Z2', rail: 'upper', region: 'upper' },
  { id: 'Z3', rail: 'upper', region: 'upper' },
  { id: 'Z4', rail: 'upper', region: 'upper' },
  { id: 'Z5', rail: 'upper', region: 'upper' },
  { id: 'Z6', rail: 'lower', region: 'middle' },
  { id: 'Z7', rail: 'lower', region: 'middle' },
  { id: 'Z8', rail: 'lower', region: 'lower' },
  { id: 'Z9', rail: 'lower', region: 'lower' },
  { id: 'Z10', rail: 'lower', region: 'lower' },
]

export const ZONE_IDS = ZONES.map((z) => z.id)

export interface ZoneMapping {
  direction: Direction
  heights: Height[]
  /** Fires only at the closest distance tier, as a close-range reinforcement. */
  nearOnly?: boolean
}

export type ZoneMap = Record<ZoneId, ZoneMapping | null>

export const DEFAULT_ZONE_MAP: ZoneMap = {
  Z1: { direction: 'front', heights: ['head'] },
  Z2: { direction: 'diagonal', heights: ['head'] },
  Z3: { direction: 'diagonal', heights: ['head'], nearOnly: true },
  Z4: { direction: 'side', heights: ['head'] },
  Z5: null,
  Z6: { direction: 'diagonal', heights: ['chest'] },
  Z7: { direction: 'side', heights: ['chest'] },
  Z8: { direction: 'diagonal', heights: ['waist'] },
  Z9: { direction: 'side', heights: ['waist'] },
  Z10: { direction: 'front', heights: ['chest', 'waist'] },
}

export const TACTILE_ZONE_IDS: ZoneId[] = ZONE_IDS.filter((z) => z !== 'Z5')

export type SurfaceFinish = 'matte' | 'satin' | 'textured'
export type PrintPreset = 'fdm' | 'service'

export const PETAL_COLORS = ['#f1f1ef', '#ece6da', '#dfe4e6', '#ead9d6', '#dcdfd6'] as const

export interface Cues {
  space: boolean
  air: boolean
  uv: boolean
  thermal: boolean
  tap: boolean
}

export interface Config {
  schemaVersion: 1
  id: string
  name: string
  updatedAt: string
  mode: Mode
  sizePreset: SizePreset | 'custom'
  values: NumericValues
  enabledZones: ZoneId[]
  shadeDeployed: boolean
  petalColor: string
  surfaceFinish: SurfaceFinish
  cues: Cues
  hapticByZone: Partial<Record<ZoneId, number>>
  zoneMap: ZoneMap
  printPreset: PrintPreset
  /** Set only when the wearer has personally confirmed the feedback settings. */
  feedbackConfirmed: boolean
}

export const CONFIG_SCHEMA_VERSION = 1

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
    enabledZones: ZONE_IDS.filter((z) => z !== 'Z5'),
    shadeDeployed: true,
    petalColor: PETAL_COLORS[0],
    surfaceFinish: 'satin',
    cues: { space: true, air: true, uv: true, thermal: true, tap: true },
    hapticByZone: {},
    zoneMap: DEFAULT_ZONE_MAP,
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
    zoneMap: config.zoneMap,
    feedbackConfirmed: config.feedbackConfirmed,
  }
}

export function parseConfig(text: string): Config {
  const raw = JSON.parse(text) as Partial<Config>
  if (raw?.schemaVersion !== CONFIG_SCHEMA_VERSION) throw new Error('schema')
  const base = createConfig(raw.name ?? 'Imported', raw.id ?? crypto.randomUUID())
  return {
    ...base,
    ...raw,
    values: { ...base.values, ...raw.values },
    cues: { ...base.cues, ...raw.cues },
    zoneMap: { ...base.zoneMap, ...raw.zoneMap },
  }
}
