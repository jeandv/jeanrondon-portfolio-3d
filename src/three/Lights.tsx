import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { PointLight } from 'three'
import { FILL_LAMP_OFF, LIGHT_RIG } from './lightRig'
import { LAMP_MIX } from './materials/lampMix'

/**
 * Ambient, warm fill and moon (rig values in lightRig.ts). The fill stands
 * for the lamp's bounce, so it dims with it; the lamp itself (spot + bulb) is
 * objects/Lamp.tsx, the TV spill objects/TvGlow.tsx.
 */
export function Lights() {
  const rig = LIGHT_RIG
  const fillRef = useRef<PointLight>(null)

  useFrame(() => {
    const fill = fillRef.current
    if (fill) fill.intensity = rig.fill.intensity * (1 - (1 - FILL_LAMP_OFF) * LAMP_MIX.value)
  })

  return (
    <>
      <hemisphereLight args={[rig.hemisphere.sky, rig.hemisphere.ground, rig.hemisphere.intensity]} />
      <pointLight
        ref={fillRef}
        color={rig.fill.color}
        intensity={rig.fill.intensity}
        position={rig.fill.position}
        decay={2}
      />
      <directionalLight color={rig.moon.color} intensity={rig.moon.intensity} position={rig.moon.position} />
    </>
  )
}
