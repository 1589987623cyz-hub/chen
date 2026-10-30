import { describe, expect, it } from 'vitest'
import { createConfig } from '@/domain/params'
import { flatPetal, maskScale, PETALS } from '@/geometry/mask'
import { simulateObstacle } from '@/scene/feedback'
import { zoneDeploy } from '@/geometry/mask'
import { stlBinary, threeMf, zip } from './files'

describe('file formats', () => {
  const base = createConfig('t', 't')
  const mesh = flatPetal(base, PETALS[0], maskScale(base.values))

  it('writes a binary STL with the right size and triangle count', () => {
    const stl = stlBinary(mesh, 'petal')
    const count = mesh.indices.length / 3
    expect(stl.length).toBe(84 + count * 50)
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(count)
  })

  it('writes a zip with local and central records', () => {
    const data = zip([{ path: 'a.txt', data: new TextEncoder().encode('hello') }])
    const view = new DataView(data.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(data.length - 22, true)).toBe(0x06054b50)
    expect(view.getUint16(data.length - 12, true)).toBe(1)
  })

  it('writes a 3MF package', () => {
    const text = new TextDecoder().decode(threeMf(mesh, 'petal'))
    expect(text).toContain('3D/3dmodel.model')
    expect(text).toContain('[Content_Types].xml')
    expect(text).toContain('<triangle ')
  })
})

describe('feedback simulation', () => {
  const c = createConfig('t', 't')
  const full = zoneDeploy(c, 'full', 'upper')

  it('maps a head-height obstacle ahead to Z1 on both sides', () => {
    const r = simulateObstacle(c, { direction: 'front', height: 'head', side: 'left', distance: 1.5 }, 'full', full)
    expect(r.tier).toBe('slow')
    expect(r.zones).toEqual([{ zone: 'Z1', side: 1 }, { zone: 'Z1', side: -1 }])
  })

  it('adds the close-range zone only at the nearest tier', () => {
    const near = simulateObstacle(c, { direction: 'diagonal', height: 'head', side: 'right', distance: 0.4 }, 'full', full)
    const far = simulateObstacle(c, { direction: 'diagonal', height: 'head', side: 'right', distance: 1.5 }, 'full', full)
    expect(near.tier).toBe('hold')
    expect(near.zones.map((z) => z.zone)).toEqual(['Z2', 'Z3'])
    expect(far.zones.map((z) => z.zone)).toEqual(['Z2'])
  })

  it('stays silent beyond the far boundary', () => {
    expect(simulateObstacle(c, { direction: 'front', height: 'head', side: 'left', distance: 3 }, 'full', full).tier).toBe('none')
  })

  it('uses the ear hub for a straight-ahead obstacle in standby', () => {
    const r = simulateObstacle(c, { direction: 'front', height: 'chest', side: 'left', distance: 1 }, 'standby', zoneDeploy(c, 'standby', 'upper'))
    expect(r.earOnly).toBe(true)
  })
})
