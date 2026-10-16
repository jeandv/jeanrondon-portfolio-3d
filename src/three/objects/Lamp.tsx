import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CircleGeometry, Color, Mesh, MeshBasicMaterial, Object3D, Vector3, type SpotLight } from 'three'
import { CAPTURE } from '../../capture/mode'
import { useStore } from '../../state/store'
import { LIGHT_RIG } from '../lightRig'
import { LAMP_MIX, lampMixTarget, stepLampMix } from '../materials/lampMix'
import { nodeSpaceBounds } from './bounds'
import { clampDt } from './motion'
import { swapMaterial } from './screenRuntime'

/**
 * Desk lamp on/off (plan §10.1; no key binding, like the reference). The
 * shared LAMP_MIX (0 on, 1 off) fades over ~250 ms (snaps with reduced motion,
 * always on in ?capture) and drives, in sync: the baked irradiance blend
 * (lampMix.ts), the realtime spot (greybox), the warm fill (Lights.tsx) and
 * the bulb. The bulb is the optional `lamp_bulb` node, or a small disc on the
 * open (−Y) side of `lamp_head`.
 */

const FALLBACK_LAMP = { position: new Vector3(-0.36, 1.33, -0.02), target: new Vector3(-0.12, 0.75, 0.18) }

/** Linear HDR: the lit bulb blooms (threshold .88), the dark one is grey glass. */
const BULB_ON = new Color('#ffd7a0').multiplyScalar(2.6)
const BULB_OFF = new Color('#2a261f')

/** Lamp pose from the GLB: `lamp_head` shines along its local −Y. */
function lampPose(room: Object3D): { position: Vector3; target: Vector3 } {
  const head = room.getObjectByName('lamp_head')
  if (!head) return FALLBACK_LAMP
  head.updateWorldMatrix(true, false)
  const position = head.getWorldPosition(new Vector3())
  const direction = new Vector3(0, -1, 0).transformDirection(head.matrixWorld)
  return { position, target: position.clone().add(direction) }
}

interface Bulb {
  readonly material: MeshBasicMaterial
  /** Mounts the bulb; returns the cleanup. */
  attach(): () => void
}

function createBulb(room: Object3D): Bulb | null {
  const material = new MeshBasicMaterial({ name: 'M_lamp_bulb', color: BULB_ON.clone(), toneMapped: false })
  const authored = room.getObjectByName('lamp_bulb')
  if (authored instanceof Mesh) return { material, attach: () => swapMaterial(authored, material) }

  const head = room.getObjectByName('lamp_head')
  if (!head) return null
  const box = nodeSpaceBounds(head)
  if (box.isEmpty()) return null
  const size = box.getSize(new Vector3())
  const scaleY = Math.abs(head.scale.y) || 1
  const radius = 0.32 * Math.min(size.x, size.z)
  const geometry = new CircleGeometry(radius, 24)
  const mesh = new Mesh(geometry, material)
  mesh.name = 'lamp_bulb_auto'
  // Its own contract identity (never mistaken for a quantization child of lamp_head).
  mesh.userData = { name: 'lamp_bulb_auto', runtimeHelper: true }
  const center = box.getCenter(new Vector3())
  mesh.position.set(center.x, box.min.y - 0.0005 / scaleY, center.z)
  // The circle faces +Z; turn it to face the head's open −Y side.
  mesh.rotation.x = Math.PI / 2
  return {
    material,
    attach: () => {
      head.add(mesh)
      return () => {
        head.remove(mesh)
        geometry.dispose()
      }
    },
  }
}

export interface LampProps {
  readonly room: Object3D
}

export function Lamp({ room }: LampProps) {
  const pose = useMemo(() => lampPose(room), [room])
  const target = useMemo(() => {
    const object = new Object3D()
    object.position.copy(pose.target)
    return object
  }, [pose])
  const bulb = useMemo(() => createBulb(room), [room])
  const spotRef = useRef<SpotLight>(null)

  useEffect(() => {
    if (!bulb) return
    const detach = bulb.attach()
    return () => {
      detach()
      bulb.material.dispose()
    }
  }, [bulb])

  useFrame((_, delta) => {
    const { lampOn, reducedMotion } = useStore.getState()
    LAMP_MIX.value = stepLampMix(LAMP_MIX.value, lampMixTarget(CAPTURE || lampOn), clampDt(delta), reducedMotion || CAPTURE)
    const on = 1 - LAMP_MIX.value
    if (spotRef.current) spotRef.current.intensity = LIGHT_RIG.lamp.intensity * on
    bulb?.material.color.copy(BULB_OFF).lerp(BULB_ON, on)
  })

  if (LIGHT_RIG.lamp.intensity <= 0) return null
  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={spotRef}
        color={LIGHT_RIG.lamp.color}
        intensity={LIGHT_RIG.lamp.intensity}
        angle={LIGHT_RIG.lamp.angle}
        penumbra={LIGHT_RIG.lamp.penumbra}
        decay={2}
        position={pose.position}
        target={target}
      />
    </>
  )
}
