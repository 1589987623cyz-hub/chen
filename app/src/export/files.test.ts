import { describe, expect, it } from 'vitest'
import { tileMesh, tiles } from '@/geometry/mask'
import { stlBinary, threeMf, zip } from './files'

describe('file formats', () => {
  const mesh = tileMesh(tiles[0])

  it('writes a binary STL with the right size and triangle count', () => {
    const stl = stlBinary(mesh, 'tile')
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
    const text = new TextDecoder().decode(threeMf(mesh, 'tile'))
    expect(text).toContain('3D/3dmodel.model')
    expect(text).toContain('[Content_Types].xml')
    expect(text).toContain('<triangle ')
  })
})
