import { describe, expect, it } from 'vitest'
import { createConfig, SIZE_PRESETS, ZONES, type SizePreset } from '@/domain/params'
import { hasBlockingIssue, validate } from '@/domain/validate'
import { buildPrintParts, buildShell, buildWorn, maskScale, petalCount, surface, zoneDeploy } from './mask'
import { isClosed, signedVolume, tube } from './mesh'

const config = () => createConfig('test', 'test-id')

describe('default configuration', () => {
  for (const size of Object.keys(SIZE_PRESETS) as SizePreset[]) {
    it(`has no blocking issue for size ${size}`, () => {
      const c = config()
      c.values = { ...c.values, ...SIZE_PRESETS[size] }
      expect(validate(c).filter((i) => i.severity === 'error')).toEqual([])
    })
  }
})

describe('hard limits', () => {
  it('rejects petals wide enough to reach the openings', () => {
    const c = config()
    c.values.petalScale = 130
    expect(validate(c).some((i) => i.code === 'openZone')).toBe(true)
  })

  it('rejects a value outside its range', () => {
    const c = config()
    c.values.petalScale = 40
    const issues = validate(c)
    expect(issues[0]).toMatchObject({ code: 'range', field: 'petalScale' })
    expect(hasBlockingIssue(issues)).toBe(true)
  })

  it('rejects haptic mapping on the shade zone', () => {
    const c = config()
    c.zoneMap = { ...c.zoneMap, Z5: { direction: 'side', heights: ['head'] } }
    expect(validate(c).some((i) => i.code === 'shadeMapped')).toBe(true)
  })

  it('requires at least one alert cue', () => {
    const c = config()
    c.cues.thermal = false
    c.cues.tap = false
    expect(validate(c).some((i) => i.code === 'noCue')).toBe(true)
  })

  it('rejects unordered distance tiers', () => {
    const c = config()
    c.values.distanceNear = 1
    c.values.distanceMid = 1
    expect(validate(c).some((i) => i.code === 'distanceOrder')).toBe(true)
  })

  it('applies stricter limits to FDM printing', () => {
    const c = config()
    c.values.petalThickness = 0.8
    expect(validate(c).some((i) => i.code === 'printThickness')).toBe(true)
    c.printPreset = 'service'
    expect(validate(c).some((i) => i.code === 'printThickness')).toBe(false)
  })
})

describe('shape', () => {
  it('matches the drawing proportions at the default size', () => {
    const s = maskScale(config().values)
    expect(surface(s, 408, 60)[1] - surface(s, 408, 815)[1]).toBeCloseTo(196, 0)
    expect(Math.abs(surface(s, 408 - 298, 340)[0]) * 2).toBeCloseTo(155, 0)
  })
})

describe('meshes', () => {
  it('produces closed, outward-facing printable petals', () => {
    const petals = buildPrintParts(config()).filter((p) => p.group === 'petals')
    expect(petals.length).toBe(petalCount())
    for (const part of petals) {
      expect(isClosed(part.mesh)).toBe(true)
      expect(signedVolume(part.mesh)).toBeGreaterThan(0)
    }
  })

  it('keeps worn petals closed', () => {
    const parts = buildWorn(config(), { deploy: zoneDeploy(config(), 'full', 'upper') })
    for (const part of parts.filter((p) => p.material === 'petal')) {
      expect(isClosed(part.mesh)).toBe(true)
    }
  })

  it('keeps the carrier plate closed', () => {
    const plate = buildShell(config()).find((p) => p.name === 'carrier_plate')!
    expect(isClosed(plate.mesh)).toBe(true)
  })

  it('produces closed tubes', () => {
    const mesh = tube([[0, 0, 0], [0, 0, 10], [5, 0, 20]], 2)
    expect(isClosed(mesh)).toBe(true)
    expect(signedVolume(mesh)).toBeGreaterThan(0)
  })
})

describe('wear states', () => {
  it('keeps everything retracted in standby', () => {
    const deploy = zoneDeploy(config(), 'standby', 'upper')
    expect(Object.values(deploy).every((d) => d === 0)).toBe(true)
  })

  it('deploys one region in adaptive', () => {
    const deploy = zoneDeploy(config(), 'adaptive', 'middle')
    expect(ZONES.filter((z) => deploy[z.id] === 1).map((z) => z.id)).toEqual(['Z5', 'Z6', 'Z7'])
  })

  it('never deploys a disabled zone', () => {
    const c = config()
    c.enabledZones = c.enabledZones.filter((z) => z !== 'Z1')
    expect(zoneDeploy(c, 'full', 'upper').Z1).toBe(0)
  })
})
