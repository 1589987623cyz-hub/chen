declare module 'rhino3dm/rhino3dm.module.js' {
  const init: (options?: { locateFile?: (file: string) => string }) => Promise<any>
  export default init
}

declare module '@exsense/reference/maskGeometry.js' {
  import type { BufferGeometry, Group, Mesh, Vector3 } from 'three'
  export interface ShellSurface {
    uvTo3D(u: number, v: number, offset?: number, out?: Vector3): Vector3
  }
  export function makeShell(params: unknown): ShellSurface
  export function buildTileGeometry(tile: unknown, params: unknown, shell: ShellSurface): BufferGeometry
  export function buildMask(params: unknown, tiles: unknown, pins: unknown): { root: Group; shell: ShellSurface }
  export function setTileTravel(mesh: Mesh, mm: number): void
}
