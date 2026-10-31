import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NUMERIC_PARAMS, SECTORS, ZONE_IDS } from '@/domain/params'
import { en, zh } from './messages'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

describe('translations', () => {
  it('has the same keys in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('covers every literal key used in the code', () => {
    const missing = new Set<string>()
    for (const file of sources('src')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\('([\w.]+)'/g)) {
        if (!(match[1] in zh)) missing.add(match[1])
      }
    }
    expect([...missing]).toEqual([])
  })

  it('covers keys built at runtime', () => {
    const keys = [
      ...NUMERIC_PARAMS.map((p) => `param.${p.key}`),
      ...ZONE_IDS.map((z) => `place.${z}`),
      ...SECTORS.map((s) => `sector.${s}`),
      ...['size', 'zones', 'feedback', 'structure', 'review'].map((s) => `step.${s}`),
      ...['rest', 'space', 'air', 'uv'].map((m) => `mode.${m}`),
      ...['front', 'side', 'back', 'top', 'angle'].map((v) => `view.${v}`),
      ...['space', 'air', 'uv', 'thermal', 'tap'].map((c) => `cue.${c}`),
      ...['pending', 'active'].map((s) => `collab.${s}`),
    ]
    expect(keys.filter((k) => !(k in zh))).toEqual([])
  })
})
