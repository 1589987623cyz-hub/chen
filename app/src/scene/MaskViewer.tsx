import { Canvas, useThree } from '@react-three/fiber'
import { Environment, Html, Lightformer, Line, OrbitControls } from '@react-three/drei'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ZONES, type Config, type ZoneId } from '@/domain/params'
import {
  buildShell,
  buildWorn,
  maskScale,
  OPENINGS,
  PETAL_CENTERS,
  surface,
  type MaskScale,
  type Part,
  type Side,
} from '@/geometry/mask'
import { appendMesh, emptyMesh, type Mesh } from '@/geometry/mesh'

export type ViewName = 'front' | 'side' | 'top' | 'angle'

export interface ViewerProps {
  config: Config
  deploy: Record<ZoneId, number>
  view?: ViewName
  showOpenZones?: boolean
  highlightZone?: ZoneId | null
  exploded?: boolean
  fitMode?: boolean
  active?: { zone: ZoneId; side: Side }[]
  blinkHz?: number
  label: string
}

const VIEW_POSITIONS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 620],
  side: [620, 0, 0.01],
  top: [0, 620, 0.01],
  angle: [-300, 90, 520],
}

function toGeometry(mesh: Mesh, base?: string) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3))
  geometry.setIndex(mesh.indices)
  geometry.computeVertexNormals()
  if (base && mesh.shade) {
    const pearl = new THREE.Color(base)
    const ivory = new THREE.Color('#e9dcc2')
    const color = new THREE.Color()
    const colors = new Float32Array(mesh.shade.length * 3)
    mesh.shade.forEach((shade, i) => color.copy(pearl).lerp(ivory, shade * 0.7).toArray(colors, i * 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }
  return geometry
}

function mergeParts(parts: Part[], exploded: boolean, base?: string) {
  const merged = emptyMesh()
  for (const part of parts) {
    if (!exploded) {
      appendMesh(merged, part.mesh)
      continue
    }
    const offset = part.group === 'petals' ? 34 : 0
    appendMesh(merged, {
      ...part.mesh,
      positions: part.mesh.positions.map((v, i) => (i % 3 === 2 ? v + offset : v)),
    })
  }
  return toGeometry(merged, base)
}

function ViewCamera({ view }: { view: ViewName }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { update?: () => void; target?: THREE.Vector3 } | null
  useEffect(() => {
    camera.position.set(...VIEW_POSITIONS[view])
    camera.lookAt(0, 0, 0)
    controls?.target?.set(0, 0, 0)
    controls?.update?.()
  }, [view, camera, controls])
  return null
}

function OpeningLines({ scale }: { scale: MaskScale }) {
  return OPENINGS.map((opening, k) => {
    const points = [...opening.points, opening.points[0]].map(([x, y]) => surface(scale, x, y, 4))
    return <Line key={k} points={points} color="#1f8a55" lineWidth={2} />
  })
}

function ZoneLabel({ scale, zone }: { scale: MaskScale; zone: ZoneId }) {
  const [x, y] = PETAL_CENTERS[zone]
  return (
    <Html position={surface(scale, x, y, 18)} center zIndexRange={[5, 0]}>
      <span aria-hidden="true" className="rounded bg-black px-1.5 py-0.5 text-sm font-semibold text-white">{zone}</span>
    </Html>
  )
}

function Carrier({ config }: { config: Config }) {
  const { faceWidth, faceHeight, earToNoseBridge, railWidth } = config.values
  const geometry = useMemo(
    () => mergeParts(buildShell(config), false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faceWidth, faceHeight, earToNoseBridge, railWidth],
  )
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#b4b6b8" metalness={0.15} roughness={0.5} side={THREE.DoubleSide} />
    </mesh>
  )
}

const ALL_ZONES = (value: number) => Object.fromEntries(ZONES.map((z) => [z.id, value])) as Record<ZoneId, number>

interface Morph {
  geometry: THREE.BufferGeometry
  from: Float32Array
  to: Float32Array
  ranges: { zone?: ZoneId; start: number; end: number }[]
}

/** Blends one set of parts between its closed and open poses without rebuilding it. */
function createMorph(closed: Part[], open: Part[], keep: (p: Part) => boolean, exploded: boolean, base?: string): Morph {
  const closedKept = closed.filter(keep)
  const openKept = open.filter(keep)
  const geometry = mergeParts(openKept, exploded, base)
  const to = (geometry.attributes.position.array as Float32Array).slice()
  const from = new Float32Array(mergeParts(closedKept, exploded).attributes.position.array)
  const ranges: Morph['ranges'] = []
  let start = 0
  for (const part of openKept) {
    const end = start + part.mesh.positions.length
    ranges.push({ zone: part.zone, start, end })
    start = end
  }
  return { geometry, from, to, ranges }
}

function applyDeploy(morph: Morph, deploy: Record<ZoneId, number>) {
  const position = morph.geometry.attributes.position
  const target = position.array as Float32Array
  for (const { zone, start, end } of morph.ranges) {
    const d = zone ? deploy[zone] : 1
    const t = d * d * (3 - 2 * d)
    for (let i = start; i < end; i++) target[i] = morph.from[i] + (morph.to[i] - morph.from[i]) * t
  }
  position.needsUpdate = true
  morph.geometry.computeVertexNormals()
}

function Mask({ config, deploy, exploded, highlightZone, active, blinkHz }: ViewerProps) {
  const closed = useMemo(() => buildWorn(config, { deploy: ALL_ZONES(0) }), [config])
  const open = useMemo(() => buildWorn(config, { deploy: ALL_ZONES(1) }), [config])
  const morphs = useMemo(() => {
    const blown = !!exploded
    const isPetal = (p: Part) => p.material === 'petal'
    const isActive = (p: Part) =>
      isPetal(p) && !!active?.some((a) => p.zone === a.zone && (p.side === a.side || p.name.endsWith('_C')))
    const isHighlighted = (p: Part) => isPetal(p) && p.zone === highlightZone
    const make = (keep: (p: Part) => boolean, base?: string) => createMorph(closed, open, keep, blown, base)
    return {
      petal: make((p) => isPetal(p) && !isHighlighted(p) && !isActive(p), config.petalColor),
      highlight: make(isHighlighted, '#f0b45a'),
      active: make(isActive, '#5cc7ea'),
      node: make((p) => p.material === 'node'),
    }
  }, [closed, open, highlightZone, exploded, active, config.petalColor])

  useLayoutEffect(() => {
    for (const morph of Object.values(morphs)) applyDeploy(morph, deploy)
  }, [morphs, deploy])

  const activeMaterial = useRef<THREE.MeshPhysicalMaterial>(null)
  useEffect(() => {
    if (!blinkHz || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => {
      if (activeMaterial.current) {
        activeMaterial.current.emissiveIntensity = 0.3 + 0.3 * Math.sin(performance.now() * 0.00628 * blinkHz)
      }
    }, 40)
    return () => clearInterval(timer)
  }, [blinkHz])

  const roughness = config.surfaceFinish === 'matte' ? 0.62 : config.surfaceFinish === 'satin' ? 0.42 : 0.52
  const frosted = {
    vertexColors: true,
    roughness,
    clearcoat: 0.45,
    clearcoatRoughness: 0.4,
    side: THREE.DoubleSide,
  }
  return (
    <group>
      <mesh geometry={morphs.petal.geometry} castShadow receiveShadow>
        <meshPhysicalMaterial {...frosted} transparent opacity={0.94} />
      </mesh>
      <mesh geometry={morphs.highlight.geometry} castShadow>
        <meshPhysicalMaterial {...frosted} />
      </mesh>
      <mesh geometry={morphs.active.geometry} castShadow>
        <meshPhysicalMaterial ref={activeMaterial} {...frosted} emissive="#2aa8d8" emissiveIntensity={0.4} />
      </mesh>
      <mesh geometry={morphs.node.geometry}>
        <meshStandardMaterial color="#8d9093" roughness={0.45} />
      </mesh>
    </group>
  )
}

export default function MaskViewer(props: ViewerProps) {
  const { config, view = 'front', showOpenZones, highlightZone, fitMode, label } = props
  const { faceWidth, faceHeight, earToNoseBridge } = config.values
  const scale = useMemo(
    () => maskScale(config.values),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faceWidth, faceHeight, earToNoseBridge],
  )
  return (
    <div
      role="img"
      aria-label={label}
      className="h-full w-full overflow-hidden rounded-lg border border-line"
      style={{
        backgroundColor: '#fbfbfa',
        backgroundImage:
          'linear-gradient(#e9e9e7 1px, transparent 1px), linear-gradient(90deg, #e9e9e7 1px, transparent 1px)',
        backgroundSize: '44px 44px',
      }}
    >
      <Canvas
        shadows
        camera={{ position: VIEW_POSITIONS[view], fov: 24, near: 10, far: 2000 }}
        gl={{ preserveDrawingBuffer: true, alpha: true, toneMapping: THREE.NoToneMapping }}
      >
        <ViewCamera view={view} />
        <ambientLight intensity={0.5} />
        <directionalLight
          castShadow
          position={[-140, 220, 360]}
          intensity={0.95}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-170}
          shadow-camera-right={170}
          shadow-camera-top={170}
          shadow-camera-bottom={-170}
          shadow-camera-near={100}
          shadow-camera-far={900}
          shadow-bias={-0.0005}
          shadow-normalBias={1}
          shadow-radius={6}
        />
        <directionalLight position={[220, -60, 200]} intensity={0.3} />
        <Environment resolution={128}>
          <Lightformer intensity={1.1} position={[0, 4, 5]} scale={[10, 6, 1]} />
          <Lightformer intensity={0.9} position={[-6, 0, 2]} scale={[4, 8, 1]} />
          <Lightformer intensity={0.9} position={[6, 0, 2]} scale={[4, 8, 1]} />
        </Environment>
        <Carrier config={config} />
        <Mask {...props} />
        {(showOpenZones || fitMode) && <OpeningLines scale={scale} />}
        {highlightZone && <ZoneLabel scale={scale} zone={highlightZone} />}
        <OrbitControls makeDefault enablePan={false} minDistance={260} maxDistance={900} />
      </Canvas>
    </div>
  )
}
