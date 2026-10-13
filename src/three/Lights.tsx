import { useMemo } from 'react'
import { Object3D, Vector3 } from 'three'
import { HAS_BAKES } from './materials/baked'

type Vec3 = [number, number, number]

interface LightRig {
  readonly hemisphere: { readonly sky: string; readonly ground: string; readonly intensity: number }
  readonly fill: { readonly color: string; readonly intensity: number; readonly position: Vec3 }
  readonly moon: { readonly color: string; readonly intensity: number; readonly position: Vec3 }
  readonly lamp: {
    readonly color: string
    readonly intensity: number
    readonly angle: number
    readonly penumbra: number
  }
}

const BAKED_RIG: LightRig = {
  hemisphere: { sky: '#3a4a7a', ground: '#2a1a0c', intensity: 0.14 },
  fill: { color: '#ffcf9a', intensity: 0.3, position: [-0.7, 1.35, 1.3] },
  moon: { color: '#9fb4ff', intensity: 0.3, position: [-1.6, 3.4, -4.5] },
  // TODO(phase 2): lamp on/off (irrB blend + this spot).
  lamp: { color: '#ffad5e', intensity: 0, angle: 0.62, penumbra: 0.65 },
}

/**
 * 'baked' uses the plan's values: with baked lightmaps, realtime lights only
 * touch moving objects. Untextured greybox surfaces need far more light in
 * three's physical units (radiance = albedo·E/π), so the greybox rig scales
 * them up to read as a cozy night desk. Tune here.
 */
const LIGHT_RIGS: Readonly<Record<'baked' | 'greybox', LightRig>> = {
  baked: BAKED_RIG,
  greybox: {
    hemisphere: { ...BAKED_RIG.hemisphere, intensity: BAKED_RIG.hemisphere.intensity * 20 },
    fill: { ...BAKED_RIG.fill, intensity: BAKED_RIG.fill.intensity * 8 },
    moon: { ...BAKED_RIG.moon, intensity: BAKED_RIG.moon.intensity * 4 },
    // ~2700 K warm spot from the lamp head (no shadows).
    lamp: { ...BAKED_RIG.lamp, intensity: 3 },
  },
}

const FALLBACK_LAMP = { position: new Vector3(-0.36, 1.33, -0.02), target: new Vector3(-0.12, 0.75, 0.18) }

/** Lamp pose from the GLB: `lamp_head` shines along its local −Y. */
function lampPose(room: Object3D): { position: Vector3; target: Vector3 } {
  const head = room.getObjectByName('lamp_head')
  if (!head) return FALLBACK_LAMP
  head.updateWorldMatrix(true, false)
  const position = head.getWorldPosition(new Vector3())
  const direction = new Vector3(0, -1, 0).transformDirection(head.matrixWorld)
  return { position, target: position.clone().add(direction) }
}

export interface LightsProps {
  readonly room: Object3D
}

export function Lights({ room }: LightsProps) {
  const rig = HAS_BAKES ? LIGHT_RIGS.baked : LIGHT_RIGS.greybox
  const lamp = useMemo(() => lampPose(room), [room])
  const lampTarget = useMemo(() => {
    const target = new Object3D()
    target.position.copy(lamp.target)
    return target
  }, [lamp])

  return (
    <>
      <hemisphereLight args={[rig.hemisphere.sky, rig.hemisphere.ground, rig.hemisphere.intensity]} />
      <pointLight color={rig.fill.color} intensity={rig.fill.intensity} position={rig.fill.position} decay={2} />
      <directionalLight color={rig.moon.color} intensity={rig.moon.intensity} position={rig.moon.position} />
      {rig.lamp.intensity > 0 && (
        <>
          <primitive object={lampTarget} />
          <spotLight
            color={rig.lamp.color}
            intensity={rig.lamp.intensity}
            angle={rig.lamp.angle}
            penumbra={rig.lamp.penumbra}
            decay={2}
            position={lamp.position}
            target={lampTarget}
          />
        </>
      )}
    </>
  )
}
