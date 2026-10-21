import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { Uniform, Vector3, type Material, type Object3D, type ShaderMaterial } from 'three'
import { CAPTURE, CAPTURE_CITY_TIME, DEV_CITY_TIME, DEV_HIDE_LANDMARK } from '../../capture/mode'
import { useStore } from '../../state/store'
import { FRAMES, positionFor } from '../camera/frames'
import { CITY_FAR, CITY_NEAR, createCityLayerMaterial, cylinderParams, SKY_LAYER, type CylinderLayerSpec } from '../materials/cityLayer'
import { applyGlass, createDropletMaterial, createGlassMaterial, GLASS_NODE, setDropletsRunning } from '../materials/glass'
import { createMistMaterial, MIST_LAYER } from '../materials/mist'
import {
  applyClearing,
  CLEARING_SCALE,
  clearingFor,
  createObeliskGeometry,
  createObeliskMaterial,
  obeliskPose,
  obeliskSize,
  type ObeliskPose,
} from '../materials/obelisk'
import { advanceMotionTime, createRainMaterial, RAIN_PLANES, type RainPlaneSpec } from '../materials/rain'
import { createSkyMaterial } from '../materials/skyGradient'
import { CAPTURE_LOCAL_TIME, handAngles, localSeconds } from './clock/dial'

const FALLBACK_CITY = new Vector3(-0.2, 1.625, -1.46)
const FALLBACK_GLASS = new Vector3(-0.2, 1.625, -0.46)

/** The home camera: the obelisk turns toward it and the skylines clear around it as seen from there. */
const HOME_VIEWER = positionFor(new Vector3(...FRAMES.home.target), FRAMES.home.dir, FRAMES.home.distance)

function worldPositionOf(room: Object3D, name: string, fallback: Vector3): Vector3 {
  const node = room.getObjectByName(name)
  if (!node) return fallback
  node.updateWorldMatrix(true, false)
  return node.getWorldPosition(new Vector3())
}

interface WindowMaterials {
  /** Shared clock for every window shader (seconds, reduced-motion scaled). */
  readonly time: Uniform<number>
  readonly sky: Material
  readonly far: ShaderMaterial
  readonly near: ShaderMaterial
  readonly mist: Material
  readonly rain: readonly Material[]
  readonly glass: Material
  readonly droplets: ShaderMaterial
}

function createWindowMaterials(): WindowMaterials {
  const time = new Uniform(0)
  return {
    time,
    sky: createSkyMaterial(time),
    far: createCityLayerMaterial({ spec: CITY_FAR, time }),
    near: createCityLayerMaterial({ spec: CITY_NEAR, time }),
    mist: createMistMaterial(time),
    rain: RAIN_PLANES.map((spec) => createRainMaterial(spec, time)),
    glass: createGlassMaterial(),
    droplets: createDropletMaterial(time),
  }
}

function disposeWindowMaterials({ sky, far, near, mist, rain, glass, droplets }: WindowMaterials): void {
  for (const material of [sky, far, near, mist, ...rain, glass, droplets]) material.dispose()
}

function tick({ time, droplets }: WindowMaterials, delta: number): void {
  const { reducedMotion } = useStore.getState()
  // ?capture: rain and city frozen on a fixed moment (deterministic still); ?citytime=<s> (dev) likewise.
  if (CAPTURE) time.value = CAPTURE_CITY_TIME
  else if (DEV_CITY_TIME !== null) time.value = DEV_CITY_TIME
  else time.value = advanceMotionTime(time.value, delta, reducedMotion)
  // Reduced motion: the beads stay, no drop runs.
  setDropletsRunning(droplets, !reducedMotion)
}

interface CylinderLayerProps {
  readonly spec: CylinderLayerSpec
  readonly center: Vector3
  readonly material: Material
}

/** Open cylinder segment around the anchor's vertical axis, seen from inside. */
function CylinderLayer({ spec, center, material }: CylinderLayerProps) {
  const { centerY, height, thetaStart, thetaLength } = cylinderParams(spec)
  return (
    <mesh position={[center.x, centerY, center.z]} material={material} renderOrder={spec.renderOrder}>
      <cylinderGeometry
        args={[spec.radius, spec.radius, height, spec.radialSegments, 1, true, thetaStart, thetaLength]}
      />
    </mesh>
  )
}

interface RainPlaneProps {
  readonly spec: RainPlaneSpec
  readonly glass: Vector3
  readonly material: Material
}

function RainPlane({ spec, glass, material }: RainPlaneProps) {
  const position: [number, number, number] = [glass.x + spec.offset[0], glass.y + spec.offset[1], glass.z - spec.distance]
  return (
    <mesh position={position} material={material} renderOrder={spec.renderOrder}>
      <planeGeometry args={[spec.size[0], spec.size[1]]} />
    </mesh>
  )
}

interface ObeliskProps {
  readonly pose: ObeliskPose
}

/**
 * The Obelisco de Barquisimeto (materials/obelisk.ts): opaque, so the depth
 * buffer puts it behind the near blocks, mist and rain and in front of the
 * far skyline and the sky. Its clock shows the visitor's local time (?capture: 10:09:30).
 */
function Obelisk({ pose }: ObeliskProps) {
  const { geometry, material } = useMemo(() => {
    const size = obeliskSize()
    return { geometry: createObeliskGeometry(size), material: createObeliskMaterial(size) }
  }, [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  useFrame(() => {
    const local = CAPTURE ? CAPTURE_LOCAL_TIME : localSeconds(Date.now())
    const { hour, minute } = handAngles(local)
    material.uniforms.uHands.value.set(hour, minute)
  })
  return (
    <mesh
      name="city_obelisk"
      geometry={geometry}
      material={material}
      position={pose.position}
      rotation={[0, pose.yaw, 0]}
    />
  )
}

export interface WindowViewProps {
  readonly room: Object3D
}

/**
 * The view through the window (plan §5.7): procedural sky + two skyline
 * cylinders (parallax while orbiting) + mist around `anchor_city`, two rain
 * planes behind the glass, and the tinted `window_glass` from the GLB with
 * raindrops on it (beads, and now and then a drop running down). Trains cross
 * the far skyline and planes the sky (cityTraffic.ts), inside those shaders.
 * Between the two skylines, in the right pane: the Obelisco de Barquisimeto,
 * with the blocks around it lowered a little.
 */
export function WindowView({ room }: WindowViewProps) {
  const city = useMemo(() => worldPositionOf(room, 'anchor_city', FALLBACK_CITY), [room])
  const glassCenter = useMemo(() => worldPositionOf(room, GLASS_NODE, FALLBACK_GLASS), [room])
  const materials = useMemo(() => createWindowMaterials(), [])
  const pose = useMemo(() => obeliskPose(city, HOME_VIEWER), [city])

  useEffect(() => () => disposeWindowMaterials(materials), [materials])
  useLayoutEffect(() => applyGlass(room, materials.glass, materials.droplets), [room, materials])
  useLayoutEffect(() => {
    if (DEV_HIDE_LANDMARK) return
    applyClearing(materials.near, clearingFor(CITY_NEAR, city, HOME_VIEWER, CLEARING_SCALE.near))
    applyClearing(materials.far, clearingFor(CITY_FAR, city, HOME_VIEWER, CLEARING_SCALE.far))
  }, [materials, city])
  useFrame((_, delta) => tick(materials, delta))

  return (
    <group name="window_view">
      <CylinderLayer spec={SKY_LAYER} center={city} material={materials.sky} />
      <CylinderLayer spec={CITY_FAR} center={city} material={materials.far} />
      {!DEV_HIDE_LANDMARK && <Obelisk pose={pose} />}
      <CylinderLayer spec={CITY_NEAR} center={city} material={materials.near} />
      <CylinderLayer spec={MIST_LAYER} center={city} material={materials.mist} />
      {RAIN_PLANES.map((spec, i) => {
        const material = materials.rain[i]
        return material ? <RainPlane key={spec.distance} spec={spec} glass={glassCenter} material={material} /> : null
      })}
    </group>
  )
}
