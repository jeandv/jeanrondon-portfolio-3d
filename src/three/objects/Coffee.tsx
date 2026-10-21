import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { CoffeeDriver } from './coffee/driver'

export interface CoffeeProps {
  readonly room: Object3D
}

/**
 * Coffee mug (`coffee_mug` + `coffee_liquid`): a click lifts it toward the
 * camera, tilts it for ~0.4 s (the sip sound and the level drop land there)
 * and puts it back, damped; five sips empty it (EMPTY + a clink), and it
 * refills after a while. Steam rises while it is hot and full (one billboard,
 * one draw call). Reduced motion: no lift, the level and the sound only.
 * ?capture: a full, steaming cup on a frozen clock.
 */
export function Coffee({ room }: CoffeeProps) {
  const driver = useMemo(() => CoffeeDriver.create(room), [room])

  useEffect(() => {
    if (!driver) return
    const stop = driver.start()
    return () => {
      stop()
      driver.dispose()
    }
  }, [driver])

  useFrame((state, delta) => driver?.frame(state.camera, delta))

  return driver ? <primitive object={driver.steam} /> : null
}
