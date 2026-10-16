import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { loadScreenFonts } from '../../screens/fonts'
import { TapeDriver } from './tapes/driver'

export interface TapesProps {
  readonly room: Object3D
}

/**
 * The tape shelf and the VCR (plan §10.2–3). A route to `#work/<id>` sends
 * that tape out of the rack, along an arc to the VCR and into the slot (the
 * flap swings open, a thump); the TV switches once it is in (screenChannels).
 * Another tape first ejects and flies home. Leaving #work keeps the tape in;
 * #work without a tape ejects it. Reduced motion and ?capture snap. Driven
 * every frame from refs: the store only hears about VCR state transitions.
 * Every spine carries a label from the content (one atlas, one draw call).
 */
export function Tapes({ room }: TapesProps) {
  const driver = useMemo(() => new TapeDriver(room), [room])

  useEffect(() => {
    let cancelled = false
    // Never draw the atlas with a fallback font.
    void loadScreenFonts().then(() => {
      if (!cancelled) driver.drawLabels()
    })
    return () => {
      cancelled = true
      driver.reset()
      driver.dispose()
    }
  }, [driver])

  useFrame((_, delta) => driver.frame(delta))

  const mesh = driver.labelMesh
  return mesh ? <primitive object={mesh} /> : null
}
