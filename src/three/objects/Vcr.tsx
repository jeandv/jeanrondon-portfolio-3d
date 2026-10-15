import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { useStore } from '../../state/store'
import { FlapSpring } from './motion'

export interface VcrProps {
  readonly room: Object3D
}

/** VCR flap spring (k=120, c=12): kicked open when a tape starts playing, springs shut. */
export function Vcr({ room }: VcrProps) {
  const spring = useMemo(() => {
    const flap = room.getObjectByName('vcr_flap')
    return flap ? new FlapSpring(flap) : null
  }, [room])

  useEffect(() => {
    if (!spring) return
    const unsubscribe = useStore.subscribe((state, previous) => {
      const tape = state.route.tape
      if (tape !== undefined && tape !== previous.route.tape && !state.reducedMotion) spring.kick()
    })
    return () => {
      unsubscribe()
      spring.reset()
    }
  }, [spring])

  useFrame((_, delta) => spring?.update(delta))
  return null
}
