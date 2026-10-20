import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { sfx } from '../../audio/sfx'
import { useScreenFonts } from '../../screens/fonts'
import { useStore } from '../../state/store'
import { DRAG_THRESHOLD } from '../interaction/hotspots'
import { CreditsCardRig } from './credits/rig'

const CARD_HOTSPOT = 'credits'

function onPointerOver(event: ThreeEvent<PointerEvent>): void {
  event.stopPropagation()
  useStore.getState().setHovered(CARD_HOTSPOT)
}

function onPointerOut(): void {
  const state = useStore.getState()
  if (state.hovered === CARD_HOTSPOT) state.setHovered(null)
}

/** A click on the card puts it back (like a click anywhere else while it is up). */
function onClick(event: ThreeEvent<MouseEvent>): void {
  event.stopPropagation()
  if (event.delta > DRAG_THRESHOLD) return
  const state = useStore.getState()
  if (!state.creditsOpen) return
  sfx('card')
  state.setCreditsOpen(false)
}

export interface CreditsCardProps {
  readonly room: Object3D
}

/**
 * The credits index card (src/content/credits.ts): opened by the CREDITS pill
 * or a click on the rolodex, it floats up to the middle of the frame; Esc or
 * a click anywhere files it back (tooltip PUT BACK CREDITS). On phones
 * (≤ 420 px wide) it is held upright with a larger one-column print. Suspends
 * until the screen fonts (Courier Prime) are in, so it never draws a fallback face.
 */
export function CreditsCard({ room }: CreditsCardProps) {
  useScreenFonts()
  const rig = useMemo(() => new CreditsCardRig(), [])
  useEffect(() => {
    rig.start(room)
    return () => {
      onPointerOut()
      rig.dispose()
    }
  }, [rig, room])

  useFrame((state, delta) => {
    const { width, height } = state.size
    rig.frame(state.camera, height > 0 ? width / height : 0, state.clock.elapsedTime, delta, width)
  })

  return <primitive object={rig.mesh} onPointerOver={onPointerOver} onPointerOut={onPointerOut} onClick={onClick} />
}
