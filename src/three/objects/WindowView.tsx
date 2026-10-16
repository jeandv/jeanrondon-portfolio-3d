import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { Uniform, Vector3, type Material, type Object3D } from 'three'
import { CAPTURE, CAPTURE_CITY_TIME } from '../../capture/mode'
import { useStore } from '../../state/store'
import { CITY_FAR, CITY_NEAR, createCityLayerMaterial, cylinderParams, SKY_LAYER, type CylinderLayerSpec } from '../materials/cityLayer'
import { applyGlass, createGlassMaterial, GLASS_NODE } from '../materials/glass'
import { createMistMaterial, MIST_LAYER } from '../materials/mist'
import { advanceMotionTime, createRainMaterial, RAIN_PLANES, type RainPlaneSpec } from '../materials/rain'
import { createSkyMaterial } from '../materials/skyGradient'

const FALLBACK_CITY = new Vector3(-0.2, 1.625, -1.46)
const FALLBACK_GLASS = new Vector3(-0.2, 1.625, -0.46)

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
  readonly far: Material
  readonly near: Material
  readonly mist: Material
  readonly rain: readonly Material[]
  readonly glass: Material
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
  }
}

function disposeWindowMaterials({ sky, far, near, mist, rain, glass }: WindowMaterials): void {
  for (const material of [sky, far, near, mist, ...rain, glass]) material.dispose()
}

function tick(time: Uniform<number>, delta: number): void {
  // ?capture: rain and city frozen on a fixed moment (deterministic still).
  time.value = CAPTURE ? CAPTURE_CITY_TIME : advanceMotionTime(time.value, delta, useStore.getState().reducedMotion)
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

export interface WindowViewProps {
  readonly room: Object3D
}

/**
 * The view through the window (plan §5.7): procedural sky + two skyline
 * cylinders (parallax while orbiting) + mist around `anchor_city`, two rain
 * planes behind the glass, and the tinted `window_glass` from the GLB.
 */
export function WindowView({ room }: WindowViewProps) {
  const city = useMemo(() => worldPositionOf(room, 'anchor_city', FALLBACK_CITY), [room])
  const glassCenter = useMemo(() => worldPositionOf(room, GLASS_NODE, FALLBACK_GLASS), [room])
  const materials = useMemo(() => createWindowMaterials(), [])

  useEffect(() => () => disposeWindowMaterials(materials), [materials])
  useLayoutEffect(() => applyGlass(room, materials.glass), [room, materials])
  useFrame((_, delta) => tick(materials.time, delta))

  return (
    <group name="window_view">
      <CylinderLayer spec={SKY_LAYER} center={city} material={materials.sky} />
      <CylinderLayer spec={CITY_FAR} center={city} material={materials.far} />
      <CylinderLayer spec={CITY_NEAR} center={city} material={materials.near} />
      <CylinderLayer spec={MIST_LAYER} center={city} material={materials.mist} />
      {RAIN_PLANES.map((spec, i) => {
        const material = materials.rain[i]
        return material ? <RainPlane key={spec.distance} spec={spec} glass={glassCenter} material={material} /> : null
      })}
    </group>
  )
}
