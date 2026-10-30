declare module 'rhino3dm/rhino3dm.module.js' {
  const init: (options?: { locateFile?: (file: string) => string }) => Promise<any>
  export default init
}
