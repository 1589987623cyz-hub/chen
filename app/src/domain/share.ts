import { CONFIG_SCHEMA_VERSION, createConfig, NUMERIC_PARAMS, PALETTE_IDS, parseConfig, SHELL_IDS, type Config } from './params'

const SHARED_FIELDS = ['name', 'mode', 'enabledZones', 'cues', 'hapticByZone', 'printPreset', 'look', 'motion'] as const
const FEEDBACK_KEYS = NUMERIC_PARAMS.filter((p) => p.group === 'feedback').map((p) => p.key as string)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/**
 * Packs a configuration into the part of a link after `#`, which browsers never send to a server.
 * Body measurements and the wearer's confirmation stay out; only what differs from a new configuration goes in.
 */
export function encodeShare(config: Config) {
  const base = createConfig('', 'base')
  const patch: Record<string, unknown> = {}
  for (const field of SHARED_FIELDS) if (!same(config[field], base[field])) patch[field] = config[field]
  const values = Object.fromEntries(
    Object.entries(config.values).filter(([key, value]) => FEEDBACK_KEYS.includes(key) && value !== base.values[key as keyof Config['values']]),
  )
  if (Object.keys(values).length) patch.values = values
  return toBase64Url(JSON.stringify(patch))
}

/** Reads a link into a new, unconfirmed configuration. Throws if the link is damaged. */
export function decodeShare(text: string): Config {
  const patch = JSON.parse(fromBase64Url(text)) as Record<string, unknown>
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new Error('share')
  const kept = Object.fromEntries(SHARED_FIELDS.filter((field) => field in patch).map((field) => [field, patch[field]]))
  const values = Object.fromEntries(Object.entries((patch.values ?? {}) as object).filter(([key, value]) => FEEDBACK_KEYS.includes(key) && typeof value === 'number'))
  const config = parseConfig(JSON.stringify({ ...kept, values, id: crypto.randomUUID(), schemaVersion: CONFIG_SCHEMA_VERSION }))
  const palettes = [config.look.palette, ...Object.values(config.look.zonePalette)]
  const valid =
    Array.isArray(config.enabledZones) &&
    Array.isArray(config.motion.muted) &&
    typeof config.name === 'string' &&
    palettes.every((id) => PALETTE_IDS.includes(id)) &&
    SHELL_IDS.includes(config.look.shell)
  if (!valid) throw new Error('share')
  return { ...config, feedbackConfirmed: false }
}
