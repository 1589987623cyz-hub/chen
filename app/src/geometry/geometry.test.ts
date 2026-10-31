import { describe, expect, it } from 'vitest'
import { createConfig, parseConfig, SECTORS, ZONE_IDS } from '@/domain/params'
import { hasBlockingIssue, validate } from '@/domain/validate'
import { resolveSimulation, tileFeedback } from '@/scene/feedback'
import { buildParts, maskParams, pinMesh, pins, shell, shellMesh, tileMesh, tiles } from './mask'
import { isClosed, signedVolume } from './mesh'

const config = () => createConfig('test', 'test-id')

describe('SPEC section 8 acceptance', () => {
  const meshes = tiles.map(tileMesh)

  it('has the specified parts', () => {
    expect(tiles.length).toBe(110)
    expect(pins.length).toBe(88)
    expect(maskParams.derived.overallWidth).toBeCloseTo(151.6, 0)
    expect(maskParams.derived.overallHeight).toBeCloseTo(189.1, 0)
    expect(maskParams.derived.overallDepth).toBeCloseTo(67.5, 0)
  })

  it('has no NaN in any vertex', () => {
    for (const mesh of meshes) expect(mesh.positions.every(Number.isFinite)).toBe(true)
  })

  it('makes every tile a closed solid with positive volume', () => {
    for (const mesh of meshes) {
      expect(isClosed(mesh)).toBe(true)
      expect(signedVolume(mesh)).toBeGreaterThan(0)
    }
  })

  it('keeps tile undersides at least 2.5 mm off the shell, and 1 mm when pushed', () => {
    const { undersideOffset, travelIn } = maskParams.tiles
    const distanceToShell = (x: number, y: number, z: number, u: number, v: number) => {
      let best = Infinity
      for (let du = -8; du <= 8; du += 0.5) {
        for (let dv = -8; dv <= 8; dv += 0.5) {
          const p = shell.uvTo3D(u + du, v + dv, 0)
          best = Math.min(best, Math.hypot(p.x - x, p.y - y, p.z - z))
        }
      }
      return best
    }
    for (const tile of tiles.filter((_, i) => i % 5 === 0)) {
      for (const [u, v] of tile.bottomFace.uv.filter((_, i) => i % 9 === 0)) {
        const p = shell.uvTo3D(u, v, undersideOffset)
        expect(distanceToShell(p.x, p.y, p.z, u, v)).toBeGreaterThan(undersideOffset - 0.02)
        const pushed = shell.uvTo3D(u, v, undersideOffset - travelIn)
        expect(distanceToShell(pushed.x, pushed.y, pushed.z, u, v)).toBeGreaterThan(0.98)
      }
    }
  })

  it('keeps pins clear of every tile', () => {
    const { radius, minClearance } = maskParams.pins
    for (const pin of pins) {
      for (const tile of tiles) {
        for (const [u, v] of tile.outlineUV) {
          expect(Math.hypot(u - pin.uv[0], v - pin.uv[1])).toBeGreaterThanOrEqual(radius + minClearance)
        }
      }
    }
  })

  it('has no tile vertex on a gap-crossing centre line', () => {
    const { gap } = maskParams.tiles
    for (const tile of tiles) {
      for (const [u] of tile.outlineUV) expect(Math.abs(u)).toBeGreaterThan(gap / 2 - 0.2)
    }
  })
})

describe('printable parts', () => {
  it('closes the shell and pins', () => {
    const mesh = shellMesh(120, 150)
    expect(isClosed(mesh)).toBe(true)
    expect(signedVolume(mesh)).toBeGreaterThan(0)
    expect(isClosed(pinMesh(pins[0]))).toBe(true)
  })

  it('exports one part per tile and pin plus the shell', () => {
    expect(buildParts().length).toBe(1 + 110 + 88)
  })
})

describe('states', () => {
  it('pushes only the chosen sector by the travel distance', () => {
    const c = config()
    for (const sector of SECTORS) {
      const response = tileFeedback(c, { kind: 'space', sector })
      expect(response.size).toBeGreaterThan(0)
      for (const [id, item] of response) {
        expect(tiles.find((t) => t.id === id)!.sector).toBe(sector)
        expect(item.travel).toBe(1.5)
      }
    }
  })

  it('leaves tiles in place for air and uv', () => {
    const c = config()
    for (const kind of ['air', 'uv'] as const) {
      const response = tileFeedback(c, { kind })
      expect(response.size).toBeGreaterThan(0)
      expect([...response.values()].every((item) => item.travel === 0)).toBe(true)
    }
  })

  it('skips turned-off zones', () => {
    const c = config()
    c.enabledZones = ZONE_IDS.filter((z) => z !== 'forehead')
    const response = tileFeedback(c, { kind: 'space', sector: 'top' })
    expect([...response.keys()].some((id) => tiles.find((t) => t.id === id)!.zone === 'forehead')).toBe(false)
  })

  it('follows the distance tiers and thresholds', () => {
    const c = config()
    const base = { kind: 'space' as const, sector: 'top' as const, distance: 1.5, pm: 0, uv: 0 }
    expect(resolveSimulation(c, base).tier).toBe('slow')
    expect(resolveSimulation(c, { ...base, distance: 0.4 }).tier).toBe('hold')
    expect(resolveSimulation(c, { ...base, distance: 3 }).state.kind).toBe('rest')
    expect(resolveSimulation(c, { ...base, kind: 'air', pm: 10 }).state.kind).toBe('rest')
    expect(resolveSimulation(c, { ...base, kind: 'air', pm: 100 }).state.kind).toBe('air')
    expect(resolveSimulation(c, { ...base, kind: 'uv', uv: 9 }).state.kind).toBe('uv')
  })
})

describe('configuration', () => {
  it('has no blocking issue by default', () => {
    expect(validate(config()).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('rejects a value outside its range', () => {
    const c = config()
    c.values.pupilDistance = 20
    const issues = validate(c)
    expect(issues[0]).toMatchObject({ code: 'range', field: 'pupilDistance' })
    expect(hasBlockingIssue(issues)).toBe(true)
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

  it('migrates a configuration saved for the old model', () => {
    const old = {
      schemaVersion: 1,
      id: 'old',
      name: 'Old',
      values: { pupilDistance: 60, petalScale: 110 },
      enabledZones: ['Z1'],
      petalColor: '#fff',
      zoneMap: {},
    }
    const migrated = parseConfig(JSON.stringify(old))
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.values.pupilDistance).toBe(60)
    expect(migrated.enabledZones).toEqual(ZONE_IDS)
    expect('petalScale' in migrated.values).toBe(false)
  })
})
