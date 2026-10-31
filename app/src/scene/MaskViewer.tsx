import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Html, Lightformer, Line, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import contactsJson from '@exsense/contacts.json'
import pinsJson from '@exsense/pins.json'
import { buildMask, setTileTravel } from '@exsense/reference/maskGeometry.js'
import sensorsJson from '@exsense/sensors.json'
import tilesJson from '@exsense/tiles.json'
import type { Config, ZoneId } from '@/domain/params'
import { maskParams, openingOutlines, shell, tiles } from '@/geometry/mask'
import { tileFeedback, type MaskState } from './feedback'

export type ViewName = 'front' | 'side' | 'back' | 'top' | 'angle'

export interface ViewerProps {
  config: Config
  state?: MaskState
  view?: ViewName
  showOpenZones?: boolean
  highlightZone?: ZoneId | null
  exploded?: boolean
  blinkHz?: number
  label: string
}

const TARGET: [number, number, number] = [0, 2.6, -maskParams.derived.overallDepth / 2]
const DISTANCE = 760
const VIEW_POSITIONS: Record<ViewName, [number, number, number]> = {
  front: [TARGET[0], TARGET[1], TARGET[2] + DISTANCE],
  // Matches drawing 03, which shows the front of the mask on the right.
  side: [TARGET[0] - DISTANCE, TARGET[1], TARGET[2] + 0.01],
  back: [TARGET[0], TARGET[1], TARGET[2] - DISTANCE],
  top: [TARGET[0], TARGET[1] + DISTANCE, TARGET[2] + 0.01],
  angle: [TARGET[0] - 400, TARGET[1] + 110, TARGET[2] + 630],
}

const TILE_TWEEN_SECONDS = 0.25
const EXPLODE_TRAVEL = -16
const BASE_COLOR = new THREE.Color(0xd9d9d6)
const BLACK = new THREE.Color(0x000000)
const HIGHLIGHT = new THREE.Color('#ffb020')

function ViewCamera({ view }: { view: ViewName }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { update?: () => void; target?: THREE.Vector3 } | null
  useEffect(() => {
    camera.position.set(...VIEW_POSITIONS[view])
    camera.lookAt(...TARGET)
    controls?.target?.set(...TARGET)
    controls?.update?.()
  }, [view, camera, controls])
  return null
}

function OpeningLines() {
  const point = new THREE.Vector3()
  return openingOutlines.map((outline, k) => {
    const points = [...outline, outline[0]].map(([u, v]): [number, number, number] => {
      shell.uvTo3D(u, v, 6, point)
      return [point.x, point.y, point.z]
    })
    return <Line key={k} points={points} color="#1f8a55" lineWidth={2} />
  })
}

function ZoneLabel({ zone }: { zone: ZoneId }) {
  const list = tiles.filter((t) => t.zone === zone)
  const position = [0, 1, 2].map(
    (axis) => list.reduce((sum, t) => sum + t.centroid3D[axis], 0) / list.length + (axis === 2 ? 14 : 0),
  ) as [number, number, number]
  return (
    <Html position={position} center zIndexRange={[5, 0]}>
      <span aria-hidden="true" className="rounded bg-black px-1.5 py-0.5 text-sm font-semibold text-white">{zone}</span>
    </Html>
  )
}

function Mask({ config, state = { kind: 'rest' }, highlightZone, exploded, blinkHz = 0 }: ViewerProps) {
  const { root } = useMemo(() => buildMask(maskParams, tilesJson, pinsJson, sensorsJson, contactsJson), [])
  const meshes = useMemo(() => {
    const group = root.getObjectByName('tiles') as THREE.Group
    return group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]
  }, [root])
  const feedback = useMemo(() => tileFeedback(config, state), [config, state])
  const reduce = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(
    () => () =>
      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        ;(mesh.material as THREE.Material | undefined)?.dispose()
      }),
    [root],
  )

  useFrame(({ clock }, delta) => {
    const speed = maskParams.tiles.travelIn / TILE_TWEEN_SECONDS
    const pulse = 0.55 + 0.45 * Math.sin(clock.elapsedTime * Math.PI * 2 * 1.2)
    const blink = blinkHz > 0 && !reduce ? 0.7 + 0.3 * Math.sin(clock.elapsedTime * Math.PI * 2 * blinkHz) : 1
    for (const mesh of meshes) {
      const tile = mesh.userData.tile as (typeof tiles)[number]
      const response = feedback.get(tile.id)
      const highlighted = tile.zone === highlightZone

      const target = exploded ? EXPLODE_TRAVEL : (response?.travel ?? 0)
      const current = mesh.userData.travel as number
      const step = (exploded || current < EXPLODE_TRAVEL / 2 ? speed * 8 : speed) * delta
      const next = reduce || Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step
      if (next !== current) setTileTravel(mesh, next)

      const material = mesh.material
      const glow = response?.color ?? (highlighted ? HIGHLIGHT : BLACK)
      material.emissive.lerp(glow, reduce ? 1 : Math.min(delta * 12, 1))
      material.color.lerp(response ? response.color : highlighted ? HIGHLIGHT : BASE_COLOR, reduce ? 1 : Math.min(delta * 12, 1))
      material.emissiveIntensity = response ? (response.pulses && !reduce ? pulse : blink) * 0.7 : highlighted ? 0.35 : 0
    }
  })

  return <primitive object={root} />
}

export default function MaskViewer(props: ViewerProps) {
  const { view = 'front', showOpenZones, highlightZone, label } = props
  return (
    <div
      role="img"
      aria-label={label}
      className="h-full w-full overflow-hidden rounded-lg border border-line"
      style={{
        backgroundColor: '#f1f2f3',
        backgroundImage:
          'linear-gradient(#e2e4e6 1px, transparent 1px), linear-gradient(90deg, #e2e4e6 1px, transparent 1px)',
        backgroundSize: '44px 44px',
      }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: VIEW_POSITIONS[view], fov: 17, near: 5, far: 2000 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      >
        <ViewCamera view={view} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[-160, 240, 420]} intensity={1.5} />
        <directionalLight position={[260, -40, 300]} intensity={0.6} />
        <Environment resolution={256}>
          <Lightformer intensity={2.2} position={[0, 5, 5]} scale={[12, 6, 1]} />
          <Lightformer intensity={1.1} position={[-7, 1, 3]} scale={[4, 10, 1]} />
          <Lightformer intensity={1.1} position={[7, 1, 3]} scale={[4, 10, 1]} />
          <Lightformer intensity={0.5} position={[0, -5, 4]} scale={[12, 4, 1]} />
        </Environment>
        <Mask {...props} />
        {showOpenZones && <OpeningLines />}
        {highlightZone && <ZoneLabel zone={highlightZone} />}
        <OrbitControls makeDefault enablePan={false} minDistance={260} maxDistance={1300} target={TARGET} />
      </Canvas>
    </div>
  )
}
