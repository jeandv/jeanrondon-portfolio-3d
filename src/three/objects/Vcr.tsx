import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { useStore } from '../../state/store'
import { clampDt, FlapSpring } from './motion'
import { onDeckEvent } from './tapes/deckEvents'

export interface VcrProps {
  readonly room: Object3D
}

/**
 * VCR flap spring (k=120, c=12): the tape deck kicks it open as a tape
 * reaches the slot or starts coming out; it springs shut behind it.
 * Reduced motion keeps it closed.
 */
export function Vcr({ room }: VcrProps) {
  const spring = useMemo(() => {
    const flap = room.getObjectByName('vcr_flap')
    return flap ? new FlapSpring(flap) : null
  }, [room])

  useEffect(() => {
    if (!spring) return
    const unsubscribe = onDeckEvent((event) => {
      if (event.type === 'flap' && !useStore.getState().reducedMotion) spring.kick()
    })
    return () => {
      unsubscribe()
      spring.reset()
    }
  }, [spring])

  useFrame((_, delta) => spring?.update(clampDt(delta)))
  return null
}
