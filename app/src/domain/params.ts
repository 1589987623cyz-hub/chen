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

// Petal colours run from ivory at the base to these at the tip. Each petal keeps its own place in the list.
export const PALETTES = {
  blossom: ['#e39a98', '#e8aaa6', '#ecb6aa', '#97b39a', '#aec2a6', '#efc3a8', '#eed7cc'],
  sage: ['#8fae95', '#a3bda3', '#b7cbb0', '#c8d6be', '#9db5a8', '#d9dfc9', '#e6e4d2'],
  pearl: ['#efe3d6', '#f1e8dc', '#e8dccf', '#f4ece2', '#e2d6c8', '#ece0d8', '#f6f0e8'],
  rose: ['#c9777f', '#d68c90', '#e0a39f', '#cf8488', '#e5b3ac', '#d99a98', '#eccac2'],
  dusk: ['#a58db8', '#b9a0c0', '#c9a9bd', '#8fa5c2', '#a9bccf', '#d3b3b6', '#dccbd4'],
} as const
export type PaletteId = keyof typeof PALETTES
export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[]

export const SHELL_COLORS = { blush: '#dcbcb0', ivory: '#efe3d8', sage: '#c9d2bf', mocha: '#b89a8a' } as const
export type ShellColor = keyof typeof SHELL_COLORS
export const SHELL_IDS = Object.keys(SHELL_COLORS) as ShellColor[]

export const IDLE_MODES = ['none', 'breathe', 'wave', 'ripple', 'breeze'] as const
export type IdleMode = (typeof IDLE_MODES)[number]

/** How the petals look. It changes nothing about how the mask works, so a helper may edit it too. */
export interface PetalLook {
  palette: PaletteId
  zonePalette: Partial<Record<ZoneId, PaletteId>>
  strength: number
  opacity: number
  bloom: number
  zoneBloom: Partial<Record<ZoneId, number>>
  stagger: number
  sway: number
  size: number
  idle: IdleMode
  idleSpeed: number
  idleDepth: number
  rim: boolean
  veins: boolean
  beads: boolean
  shell: ShellColor
}

export const PRESS_PATTERNS = ['together', 'cascade'] as const
export type PressPattern = (typeof PRESS_PATTERNS)[number]

/** How the petals move. These change what the wearer feels, so only the wearer may edit them. */
export interface PetalMotion {
  travel: number
  zoneTravel: Partial<Record<ZoneId, number>>
  muted: string[]
  pattern: PressPattern
  stepMs: number
}

export const TRAVEL_RANGE = { min: 0.6, max: 1.5, step: 0.1 }
export const MAX_BLOOM_DEGREES = 14

export const MAX_SWAY_DEGREES = 12

export const defaultLook = (): PetalLook => ({
  palette: 'blossom', zonePalette: {}, strength: 100, opacity: 93, bloom: 0, zoneBloom: {}, stagger: 0, sway: 0, size: 100,
  idle: 'none', idleSpeed: 100, idleDepth: 40, rim: true, veins: true, beads: true, shell: 'blush',
})
export const defaultMotion = (): PetalMotion => ({ travel: TRAVEL_RANGE.max, zoneTravel: {}, muted: [], pattern: 'together', stepMs: 60 })

// Ready-made combinations of the pose and movement settings. Colours stay as chosen.
export const SCENES = {
  still: { bloom: 0, zoneBloom: {}, stagger: 0, sway: 0, size: 100, idle: 'none' },
  breath: { bloom: 10, zoneBloom: {}, stagger: 0, sway: 0, size: 100, idle: 'breathe', idleSpeed: 70, idleDepth: 35 },
  breeze: { bloom: 15, zoneBloom: {}, stagger: 20, sway: 4, size: 100, idle: 'breeze', idleSpeed: 100, idleDepth: 45 },
  bloom: { bloom: 70, zoneBloom: {}, stagger: 35, sway: 0, size: 104, idle: 'ripple', idleSpeed: 60, idleDepth: 25 },
} satisfies Record<string, Partial<PetalLook>>
export type SceneId = keyof typeof SCENES
export const SCENE_IDS = Object.keys(SCENES) as SceneId[]

export interface Config {
  schemaVersion: 3
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
  look: PetalLook
  motion: PetalMotion
  /** Set only when the wearer has personally confirmed the feedback settings. */
  feedbackConfirmed: boolean
}

export const CONFIG_SCHEMA_VERSION = 3

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
    look: defaultLook(),
    motion: defaultMotion(),
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
    motion: config.motion,
    feedbackConfirmed: config.feedbackConfirmed,
  }
}

export function parseConfig(text: string): Config {
  const raw = JSON.parse(text) as Omit<Partial<Config>, 'schemaVersion'> & { schemaVersion?: number }
  if (raw?.schemaVersion !== 1 && raw?.schemaVersion !== 2 && raw?.schemaVersion !== CONFIG_SCHEMA_VERSION) throw new Error('schema')
  const base = createConfig(raw.name ?? 'Imported', raw.id ?? crypto.randomUUID())
  const known = Object.fromEntries(Object.entries(raw.values ?? {}).filter(([key]) => key in base.values))
  const values = { ...base.values, ...known }
  // Version 1 described the earlier petal models, so only the wearer's own data carries over.
  if (raw.schemaVersion === 1) {
    return { ...base, updatedAt: raw.updatedAt ?? base.updatedAt, mode: raw.mode ?? base.mode, sizePreset: raw.sizePreset ?? base.sizePreset, values, cues: { ...base.cues, ...raw.cues } }
  }
  return {
    ...base,
    ...raw,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    values,
    cues: { ...base.cues, ...raw.cues },
    look: { ...base.look, ...raw.look },
    motion: { ...base.motion, ...raw.motion },
  }
}
