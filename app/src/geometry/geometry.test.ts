import { describe, expect, it } from 'vitest'
import { createConfig, feedbackFields, parseConfig, SECTORS, ZONE_IDS } from '@/domain/params'
import { hasBlockingIssue, validate } from '@/domain/validate'
import { limitTravel, pressTravel, resolveSimulation, tileFeedback } from '@/scene/feedback'
import {
  buildParts,
  contactMesh,
  contacts,
  insidePolygon,
  maskParams,
  pinMesh,
  pins,
  sensorMesh,
  sensors,
  shellMesh,
  tileMesh,
  tiles,
} from './mask'
import { isClosed, signedVolume } from './mesh'

const config = () => createConfig('test', 'test-id')

describe('SPEC section 8 acceptance', () => {
  const meshes = tiles.map(tileMesh)

  it('has the specified parts', () => {
    expect(tiles.length).toBe(maskParams.derived.tileCount)
    expect(pins.length).toBe(maskParams.derived.pinCount)
    expect(maskParams.derived.overallWidth).toBeCloseTo(151.6, 0)
    expect(maskParams.derived.overallHeight).toBeCloseTo(189.1, 0)
  })

  it('clears the reference face', () => {
    const { fit } = maskParams.derived
    expect(fit.minGap).toBeGreaterThanOrEqual(maskParams.fitReference.minClearance)
    expect(fit.noseSideClearance).toBeGreaterThanOrEqual(maskParams.fitReference.noseMinOpeningClearance)
  })

  it('gives every sector a sensor window and skin contacts', () => {
    for (const sector of SECTORS) {
      expect(sensors.some((s) => s.kind === 'space' && s.name === sector)).toBe(true)
      expect(contacts.filter((c) => c.sector === sector).length).toBeGreaterThanOrEqual(maskParams.contacts.minPerSector)
    }
    expect(sensors.filter((s) => s.kind === 'uv').length).toBe(1)
    expect(sensors.filter((s) => s.kind === 'air').length).toBe(2)
  })

  it('lets a pushed tile reach the skin', () => {
    expect(maskParams.tiles.travelIn).toBeGreaterThan(maskParams.contacts.tipGap)
    for (const c of contacts) expect(c.reach).toBeGreaterThanOrEqual(maskParams.contacts.padHeight + maskParams.contacts.tipGap)
  })

  it('keeps left and right the same', () => {
    for (const c of contacts) {
      const twin = contacts.find((d) => Math.hypot(d.uv[0] + c.uv[0], d.uv[1] - c.uv[1]) < 1)
      expect(twin?.padRadius).toBe(c.padRadius)
    }
  })

  it('keeps contact pads out of the eye and nose openings', () => {
    const { openings2D } = maskParams.outlines
    for (const c of contacts) {
      const tip = c.base3D.map((x, i) => x + c.axis[i] * c.length)
      for (const outline of Object.values(openings2D) as [number, number][][]) {
        expect(insidePolygon(outline, tip[0], tip[1])).toBe(false)
      }
    }
  })

  it('keeps every petal clear of sensor collars', () => {
    for (const s of sensors) {
      for (const tile of tiles) {
        for (const [u, v] of tile.outlineUV) {
          expect(Math.hypot(u - s.uv[0], v - s.uv[1])).toBeGreaterThan(maskParams.sensors.collarRadius)
        }
      }
    }
  })

  it('gives every diamond cell one petal, sitting on that cell, with its tip up', () => {
    const { ns, nt } = maskParams.tiles.petal
    expect(new Set(tiles.map((t) => t.id)).size).toBe(96)
    const mid = (nt - 1) / 2
    for (const tile of tiles) {
      const at = (i: number) => tile.petal.uv.slice((i * nt + mid) * 2, (i * nt + mid) * 2 + 2)
      const [u0, v0] = at(0)
      const [u1, v1] = at(ns - 1)
      expect(v1).toBeGreaterThan(v0)
      expect(Math.abs(u1 - u0) / (v1 - v0)).toBeLessThan(0.65)
      expect(Math.hypot((u0 + u1) / 2 - tile.centroidUV[0], (v0 + v1) / 2 - tile.centroidUV[1])).toBeLessThan(20)
    }
  })

  it('stacks petals so nothing passes through, even with a petal pushed in', () => {
    const { rimCrossings, pushedGap, coverPercent } = maskParams.derived.petals
    expect(rimCrossings).toBe(0)
    expect(pushedGap).toBeGreaterThanOrEqual(0)
    expect(coverPercent).toBeGreaterThan(90)
  })

  it('runs every stem clear of the petals beneath it', () => {
    for (const c of contacts) {
      const own = tiles.find((t) => t.id === c.tile)!
      expect(own.anchorUV).toEqual(c.uv)
      for (const tile of tiles) {
        if (tile.petal.rank < own.petal.rank) expect(insidePolygon(tile.outlineUV, c.uv[0], c.uv[1])).toBe(false)
      }
    }
  })

  it('has no NaN in any vertex', () => {
    for (const mesh of meshes) expect(mesh.positions.every(Number.isFinite)).toBe(true)
  })

  it('makes every petal a closed solid with positive volume', () => {
    for (const mesh of meshes) {
      expect(isClosed(mesh)).toBe(true)
      expect(signedVolume(mesh)).toBeGreaterThan(0)
    }
  })

  it('keeps every moving petal off the shell when pushed in', () => {
    const { thickness, travelIn } = maskParams.tiles
    for (const tile of tiles) expect(Math.min(...tile.petal.off) - thickness - travelIn).toBeGreaterThan(0)
  })

  it('keeps pushed petals above the posts', () => {
    const { thickness, travelIn, petal } = maskParams.tiles
    for (const pin of pins) {
      for (const tile of tiles.filter((t) => insidePolygon(t.outlineUV, pin.uv[0], pin.uv[1]))) {
        let lowest = Infinity
        for (let k = 0; k < petal.ns * petal.nt; k++) {
          if (Math.hypot(tile.petal.uv[2 * k] - pin.uv[0], tile.petal.uv[2 * k + 1] - pin.uv[1]) < 4) lowest = Math.min(lowest, tile.petal.off[k])
        }
        expect(lowest - thickness - travelIn).toBeGreaterThan(maskParams.pins.height - 0.3)
      }
    }
  })

  it('keeps both halves on their own side of the centre seam', () => {
    for (const tile of tiles) {
      for (const [u] of tile.outlineUV) expect(u * tile.centroidUV[0]).toBeGreaterThan(0)
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

  it('closes every sensor collar and contact', () => {
    for (const mesh of [...sensors.map(sensorMesh), ...contacts.map(contactMesh)]) {
      expect(isClosed(mesh)).toBe(true)
      expect(signedVolume(mesh)).toBeGreaterThan(0)
    }
  })

  it('exports one part per petal and post plus the shell', () => {
    expect(buildParts().length).toBe(1 + tiles.length + pins.length + sensors.length + contacts.length)
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

  it('leaves muted petals out and uses the chosen travel', () => {
    const c = config()
    const first = tiles.find((t) => t.sector === 'top')!
    c.motion = { ...c.motion, travel: 1, muted: [first.id] }
    const response = tileFeedback(c, { kind: 'space', sector: 'top' })
    expect(response.has(first.id)).toBe(false)
    expect([...response.values()].every((item) => item.travel <= 1)).toBe(true)
  })

  it('never lets a petal sink further into the one beneath than the room between them', () => {
    const c = config()
    const check = (travel: Map<string, number>) => {
      for (const tile of tiles) {
        const mine = travel.get(tile.id)
        if (mine === undefined) continue
        for (const [id, gap] of tile.beneath) expect(mine - (travel.get(id) ?? 0)).toBeLessThanOrEqual(gap + 0.011)
      }
    }
    for (const tile of tiles) check(pressTravel(c, [tile.id]))
    for (const sector of SECTORS) {
      const list = tiles.filter((t) => t.sector === sector)
      check(limitTravel(new Map(list.map((t, i) => [t.id, i % 2 ? 1.5 : 0.6]))))
    }
  })

  it('holds back a petal over a muted one', () => {
    const c = config()
    const over = tiles.find((t) => t.sector === 'top' && t.beneath.some(([id, gap]) => gap < 1.4 && tiles.find((x) => x.id === id)!.sector === 'top'))!
    const under = over.beneath.find(([, gap]) => gap < 1.4)!
    c.motion.muted = [under[0]]
    const item = tileFeedback(c, { kind: 'space', sector: 'top' }).get(over.id)!
    expect(item.travel).toBeLessThanOrEqual(under[1] + 0.01)
  })

  it('starts the petals underneath first in a cascade', () => {
    const c = config()
    c.motion.pattern = 'cascade'
    const response = tileFeedback(c, { kind: 'space', sector: 'top' })
    for (const tile of tiles) {
      const mine = response.get(tile.id)
      if (!mine) continue
      for (const [id] of tile.beneath) {
        const under = response.get(id)
        if (under) expect(under.delay).toBeLessThan(mine.delay)
      }
    }
  })

  it('warns when muting leaves a direction too few petals', () => {
    const c = config()
    c.motion.muted = tiles.filter((t) => t.sector === 'right').map((t) => t.id)
    expect(validate(c).some((i) => i.code === 'weakSector')).toBe(true)
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

  it('opens a shared configuration, which arrives without measurements', () => {
    const shared = {
      schemaVersion: 2,
      id: 'shared',
      name: 'Shared',
      updatedAt: '2026-10-31T00:00:00Z',
      enabledZones: ['forehead'],
      cues: { thermal: false },
      values: { pmThreshold: 50 },
    }
    const parsed = parseConfig(JSON.stringify(shared))
    expect(parsed.enabledZones).toEqual(['forehead'])
    expect(parsed.values.pmThreshold).toBe(50)
    expect(parsed.values.pupilDistance).toBe(config().values.pupilDistance)
    expect(parsed.cues).toMatchObject({ thermal: false, tap: true })
  })

  it('adds the petal settings to an older saved configuration', () => {
    const older = { schemaVersion: 2, id: 'older', name: 'Older', values: {}, cues: {}, enabledZones: ['chin'] }
    const parsed = parseConfig(JSON.stringify(older))
    expect(parsed.schemaVersion).toBe(3)
    expect(parsed.look.palette).toBe('blossom')
    expect(parsed.motion.travel).toBe(1.5)
    expect(parsed.motion.pattern).toBe('together')
    expect(parsed.look.idle).toBe('none')
  })

  it('counts petal motion as a feedback setting and look as not', () => {
    const c = config()
    expect(feedbackFields(c)).toHaveProperty('motion')
    expect(feedbackFields(c)).not.toHaveProperty('look')
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
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.values.pupilDistance).toBe(60)
    expect(migrated.enabledZones).toEqual(ZONE_IDS)
    expect('petalScale' in migrated.values).toBe(false)
  })
})
