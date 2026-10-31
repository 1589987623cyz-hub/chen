import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Html, Lightformer, Line, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import contactsJson from '@exsense/contacts.json'
import pinsJson from '@exsense/pins.json'
import { buildMask, paintPetal, setTilePose } from '@exsense/reference/maskGeometry.js'
import sensorsJson from '@exsense/sensors.json'
import tilesJson from '@exsense/tiles.json'
import { MAX_BLOOM_DEGREES, MAX_SWAY_DEGREES, PALETTES, SHELL_COLORS, type Config, type ZoneId } from '@/domain/params'
import { maskParams, openingOutlines, shell, tiles } from '@/geometry/mask'
import { pressTravel, tileFeedback, type MaskState } from './feedback'

export type ViewName = 'front' | 'side' | 'back' | 'top' | 'angle'

export interface ViewerProps {
  config: Config
  state?: MaskState
  view?: ViewName
  showOpenZones?: boolean
  highlightZone?: ZoneId | null
  exploded?: boolean
  blinkHz?: number
  selected?: string | null
  pressed?: string[]
  onSelect?: (id: string | null) => void
  idle?: boolean
  autoRotate?: boolean
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
const BASE_COLOR = new THREE.Color(0xffffff)
const BLACK = new THREE.Color(0x000000)
const HIGHLIGHT = new THREE.Color('#ffb020')
const SELECT = new THREE.Color('#c98a2e')

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

type PetalMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>

const EMPTY: string[] = []

/** Idle movement for one petal: -1 to 1, from where it sits on the face and the time. Display only. */
function idleWave(mode: Config['look']['idle'], tile: (typeof tiles)[number], time: number) {
  const [x, y] = tile.centroid2D
  if (mode === 'breathe') return Math.sin(time * 1.6)
  if (mode === 'wave') return Math.sin(time * 2.4 - y * 0.035)
  if (mode === 'ripple') return Math.sin(time * 2.6 - Math.hypot(x, y - 12) * 0.05)
  if (mode === 'breeze') return Math.sin(time * 1.9 + x * 0.03 + tile.petal.tint) * 0.6 + Math.sin(time * 3.3 + tile.petal.tint * 2) * 0.4
  return 0
}

function Mask({ config, state = { kind: 'rest' }, highlightZone, exploded, blinkHz = 0, selected, pressed = EMPTY, onSelect, idle = true }: ViewerProps) {
  const { root } = useMemo(() => buildMask(maskParams, tilesJson, pinsJson, sensorsJson, contactsJson), [])
  const group = useMemo(() => root.getObjectByName('tiles') as THREE.Group, [root])
  const meshes = useMemo(() => group.children as PetalMesh[], [group])
  const feedback = useMemo(() => tileFeedback(config, state), [config, state])
  const pressing = useMemo(() => pressTravel(config, pressed), [config, pressed])
  const started = useRef(0)
  const stateKey = JSON.stringify(state)
  const restart = useRef(true)
  useEffect(() => {
    restart.current = true
  }, [stateKey])
  const reduce = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const { look } = config

  useEffect(
    () => () =>
      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      }),
    [root],
  )

  // Stands for look.zonePalette, which is a new object on every save.
  const zoneKey = JSON.stringify(look.zonePalette)
  useEffect(() => {
    for (const mesh of meshes) {
      const tile = mesh.userData.tile as (typeof tiles)[number]
      paintPetal(mesh.geometry, tile.petal, maskParams, PALETTES[look.zonePalette[tile.zone] ?? look.palette], look.strength / 100)
    }
  }, [meshes, look.palette, zoneKey, look.strength]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const mesh of meshes) {
      mesh.material.opacity = look.opacity / 100
      mesh.material.transparent = look.opacity < 100
      mesh.material.needsUpdate = true
    }
  }, [meshes, look.opacity])

  useEffect(() => {
    const { trim } = group.userData as { trim: Record<'rim' | 'veins' | 'beads', THREE.Material> }
    trim.rim.visible = look.rim
    trim.veins.visible = look.veins
    trim.beads.visible = look.beads
  }, [group, look.rim, look.veins, look.beads])

  useEffect(() => {
    const base = root.getObjectByName('shell') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    base.material.color.set(SHELL_COLORS[look.shell])
  }, [root, look.shell])

  useFrame(({ clock }, delta) => {
    const speed = maskParams.tiles.travelIn / TILE_TWEEN_SECONDS
    const pulse = 0.55 + 0.45 * Math.sin(clock.elapsedTime * Math.PI * 2 * 1.2)
    const blink = blinkHz > 0 && !reduce ? 0.7 + 0.3 * Math.sin(clock.elapsedTime * Math.PI * 2 * blinkHz) : 1
    if (restart.current) {
      started.current = clock.elapsedTime
      restart.current = false
    }
    const since = clock.elapsedTime - started.current
    const blend = reduce ? 1 : Math.min(delta * 8, 1)
    const fullOpen = THREE.MathUtils.degToRad(MAX_BLOOM_DEGREES)
    const moving = idle && look.idle !== 'none' && !reduce
    const time = clock.elapsedTime * (look.idleSpeed / 100)
    const swayTo = THREE.MathUtils.degToRad((look.sway / 100) * MAX_SWAY_DEGREES)
    const sizeTo = look.size / 100
    for (const mesh of meshes) {
      const tile = mesh.userData.tile as (typeof tiles)[number]
      const response = feedback.get(tile.id)
      const highlighted = tile.zone === highlightZone
      const chosen = tile.id === selected
      const press = pressing.get(tile.id) ?? 0
      const bloom = (look.zoneBloom[tile.zone] ?? look.bloom) / 100
      const stagger = tile.row % 2 ? look.stagger / 100 / 2 : 0
      const stir = moving ? (idleWave(look.idle, tile, time) * (look.idleDepth / 100)) / (look.idle === 'breeze' ? 2 : 3) : 0
      const openTo = Math.max(0, bloom + stagger + (bloom + stagger > 0 || stir > 0 ? stir : 0)) * fullOpen

      const live = response && since >= response.delay ? response.travel : 0
      const target = exploded ? EXPLODE_TRAVEL : Math.max(live, press)
      const current = mesh.userData.travel as number
      const step = (exploded || current < EXPLODE_TRAVEL / 2 ? speed * 8 : speed) * delta
      const next = reduce || Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step
      const u = mesh.userData as { open: number; sway: number; size: number }
      const nextOpen = reduce ? openTo : THREE.MathUtils.lerp(u.open, openTo, blend)
      const nextSway = reduce ? swayTo : THREE.MathUtils.lerp(u.sway, swayTo + (moving && look.idle === 'breeze' ? stir * 0.12 : 0), blend)
      const nextSize = reduce ? sizeTo : THREE.MathUtils.lerp(u.size, sizeTo, blend)
      const changed = Math.abs(nextOpen - u.open) + Math.abs(nextSway - u.sway) + Math.abs(nextSize - u.size) > 1e-5
      if (next !== current || changed) setTilePose(mesh, next, nextOpen, nextSway, nextSize)

      const material = mesh.material
      const glow = response?.color ?? (chosen ? SELECT : highlighted ? HIGHLIGHT : BLACK)
      material.emissive.lerp(glow, reduce ? 1 : Math.min(delta * 12, 1))
      material.color.lerp(response ? response.color : highlighted ? HIGHLIGHT : BASE_COLOR, reduce ? 1 : Math.min(delta * 12, 1))
      material.emissiveIntensity = response ? (response.pulses && !reduce ? pulse : blink) * 0.7 : chosen ? 0.55 : highlighted ? 0.35 : 0
    }
  })

  const pick = (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect || event.delta > 4) return
    let object: THREE.Object3D | null = event.object
    while (object && !object.userData.tile) object = object.parent
    if (!object) return
    event.stopPropagation()
    const { id } = object.userData.tile as (typeof tiles)[number]
    onSelect(id === selected ? null : id)
  }

  return <primitive object={root} onClick={pick} />
}

export default function MaskViewer(props: ViewerProps) {
  const { view = 'front', showOpenZones, highlightZone, label, autoRotate } = props
  const reduce = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  return (
    <div role="img" aria-label={label} className="viewer-stage h-full w-full overflow-hidden">
      <Canvas
        dpr={[1, 2]}
        shadows
        camera={{ position: VIEW_POSITIONS[view], fov: 17, near: 5, far: 2000 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      >
        <ViewCamera view={view} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[-200, 300, 400]}
          intensity={1.8}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
          shadow-normalBias={0.5}
          shadow-camera-left={-170}
          shadow-camera-right={170}
          shadow-camera-top={170}
          shadow-camera-bottom={-170}
          shadow-camera-near={50}
          shadow-camera-far={1100}
        />
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
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={260}
          maxDistance={1300}
          target={TARGET}
          autoRotate={autoRotate && !reduce}
          autoRotateSpeed={0.6}
        />
      </Canvas>
    </div>
  )
}
