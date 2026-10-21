import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { ClockDriver } from './clock/driver'

export interface ClockProps {
  readonly room: Object3D
}

/**
 * Wall clock beside the PC: the visitor's local time with a ticking second
 * hand; a click takes the battery out (it stops) or puts it back (a quick
 * catch-up sweep). See clock/driver.ts and clock/dial.ts.
 */
export function Clock({ room }: ClockProps) {
  const driver = useMemo(() => ClockDriver.create(room), [room])
  useEffect(() => driver?.start(), [driver])
  useFrame((_, delta) => driver?.frame(delta))
  return null
}
