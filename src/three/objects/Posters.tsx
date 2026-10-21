import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { sfx } from '../../audio/sfx'
import { POSTERS } from '../../content/posters'
import { loadScreenFonts } from '../../screens/fonts'
import { useStore } from '../../state/store'
import { activeLabel, DRAG_THRESHOLD, posterHotspotId, putsBack } from '../interaction/hotspots'
import { POSTER_ATLAS, POSTER_ATLAS_PHONE } from './posters/layout'
import { createPosterRig } from './posters/rig'

const POSTER_PREFIX = posterHotspotId('')

export interface PostersProps {
  readonly room: Object3D
}

/**
 * The wall posters (src/content/posters.ts): one atlas drawn once the screen
 * fonts are in (never with a fallback face), one batched mesh, one draw call.
 * Hovering a poster shows its title (hotspots.ts); a click does nothing yet
 * (except putting back a held card / calculator, like anywhere else).
 */
export function Posters({ room }: PostersProps) {
  const phone = useStore((state) => state.device.phone)
  const rig = useMemo(() => createPosterRig(room, POSTERS, phone ? POSTER_ATLAS_PHONE : POSTER_ATLAS), [room, phone])

  useEffect(() => {
    let cancelled = false
    let stopImages: (() => void) | null = null
    void loadScreenFonts().then(() => {
      if (!cancelled) stopImages = rig.draw()
    })
    return () => {
      cancelled = true
      stopImages?.()
      rig.dispose()
    }
  }, [rig])

  useFrame(() => {
    const hovered = useStore.getState().hovered
    rig.update(hovered?.startsWith(POSTER_PREFIX) ? hovered.slice(POSTER_PREFIX.length) : null)
  })

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    // Only the nearest hit counts (an interactive object in front keeps the pointer).
    if (event.intersections[0]?.object !== rig.mesh) return
    event.stopPropagation()
    const poster = rig.posterAt(event.faceIndex)
    const id = poster ? posterHotspotId(poster.id) : null
    const state = useStore.getState()
    if (state.hovered === id) return
    state.setHovered(id)
    if (id && activeLabel(useStore.getState()) !== null) sfx('tick')
  }
  const onPointerOut = () => {
    const state = useStore.getState()
    if (state.hovered?.startsWith(POSTER_PREFIX)) state.setHovered(null)
  }
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.delta > DRAG_THRESHOLD) return
    const state = useStore.getState()
    const poster = rig.posterAt(event.faceIndex)
    if (state.phase !== 'live' || !poster) return
    if (putsBack(state, posterHotspotId(poster.id))) {
      sfx(state.creditsOpen ? 'card' : 'calc')
      state.back()
    }
  }

  return <primitive object={rig.mesh} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onClick={onClick} />
}
