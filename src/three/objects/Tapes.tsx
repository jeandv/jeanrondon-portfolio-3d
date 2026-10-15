import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { TAPES, tapeNodeName } from '../../content/work'
import { useStore } from '../../state/store'
import { TapeSlider } from './motion'

export interface TapesProps {
  readonly room: Object3D
}

/** The playing tape slides out of the rack a little (damped; snaps with reduced motion). */
export function Tapes({ room }: TapesProps) {
  const sliders = useMemo(
    () =>
      TAPES.flatMap((tape) => {
        const node = room.getObjectByName(tapeNodeName(tape.slot))
        return node ? [{ id: tape.id, slider: new TapeSlider(node) }] : []
      }),
    [room],
  )
  useEffect(() => () => sliders.forEach(({ slider }) => slider.reset()), [sliders])

  useFrame((_, delta) => {
    const { route, reducedMotion } = useStore.getState()
    for (const { id, slider } of sliders) slider.update(route.tape === id, delta, reducedMotion)
  })
  return null
}
