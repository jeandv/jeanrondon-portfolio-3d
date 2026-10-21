import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { sfx } from '../../audio/sfx'
import { useScreenFonts } from '../../screens/fonts'
import { useStore } from '../../state/store'
import { clickSound, CV_BUTTON_HOTSPOT, DRAG_THRESHOLD, getHotspot } from '../interaction/hotspots'
import { CvCardRig } from './cv/rig'

const CARD_HOTSPOT = 'cv'

export interface CvCardProps {
  readonly room: Object3D
}

/**
 * The CV index card (src/screens/cvCard.ts): opened by a click on the rolodex
 * (tooltip VIEW CV), it floats up to the middle of the frame. Its big OPEN CV
 * button opens the CV in a new tab (tooltip OPEN CV; Enter does the same,
 * hooks/useKeyboard.ts); Esc or a click anywhere else files it back (tooltip
 * PUT BACK CV). On phones (≤ 420 px wide) it is held upright with a larger
 * print. Suspends until the screen fonts (Courier Prime) are in, so it never
 * draws a fallback face.
 */
export function CvCard({ room }: CvCardProps) {
  useScreenFonts()
  const rig = useMemo(() => new CvCardRig(), [])
  useEffect(() => {
    rig.start(room)
    return () => {
      const state = useStore.getState()
      if (state.hovered === CARD_HOTSPOT || state.hovered === CV_BUTTON_HOTSPOT) state.setHovered(null)
      rig.dispose()
    }
  }, [rig, room])

  useFrame((state, delta) => {
    const { width, height } = state.size
    rig.frame(state.camera, height > 0 ? width / height : 0, state.clock.elapsedTime, delta, width)
  })

  /** Hover is the card, or its button while the pointer is over it. */
  const hover = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation()
    const onButton = event.uv !== undefined && rig.hitAt(event.uv) !== null
    rig.setButtonHover(onButton)
    const id = onButton ? CV_BUTTON_HOTSPOT : CARD_HOTSPOT
    const state = useStore.getState()
    if (state.hovered === id) return
    // Moving onto the button ticks, like a hit rect on a screen.
    if (onButton) sfx('tick')
    state.setHovered(id)
  }
  const onPointerOut = (): void => {
    rig.setButtonHover(false)
    const state = useStore.getState()
    if (state.hovered === CARD_HOTSPOT || state.hovered === CV_BUTTON_HOTSPOT) state.setHovered(null)
  }
  /** OPEN CV opens the CV (the card stays up); a click anywhere else on the card puts it back. */
  const onClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    if (event.delta > DRAG_THRESHOLD) return
    const state = useStore.getState()
    if (!state.cvOpen) return
    if (event.uv !== undefined && rig.hitAt(event.uv) !== null) {
      const button = getHotspot(CV_BUTTON_HOTSPOT)
      if (!button) return
      const sound = clickSound(button, state)
      if (sound) sfx(sound)
      button.activate(state)
      return
    }
    sfx('card')
    state.setCvOpen(false)
  }

  return <primitive object={rig.mesh} onPointerOver={hover} onPointerMove={hover} onPointerOut={onPointerOut} onClick={onClick} />
}
