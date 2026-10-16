import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { isBootPhase } from '../../boot/machine'
import { TAPES } from '../../content/work'
import { createNotepadChannel } from '../../screens/channels/notepad/work'
import { useScreenFonts } from '../../screens/fonts'
import { useStore } from '../../state/store'
import { createLitSurfaceMaterial } from '../materials/litSurface'
import { CardPlacer } from '../camera/workLayout'
import { FloatRig } from './motion'
import { ScreenSurface } from './ScreenSurface'
import { startNotepadChannel } from './screenChannels'
import { findMesh } from './screenRuntime'
import { useCanvasScreen, useDisposable } from './useScreen'

export interface NotepadProps {
  readonly room: Object3D
}

/**
 * Yellow legal pad: the work list on `notepad_page` (512×832). On #work it
 * floats from the desk to a camera-relative card pose (right of the TV, or
 * below it on portrait; see workLayout.ts), damped with a slight sway, and
 * settles back on exit; reduced motion snaps.
 */
export function Notepad({ room }: NotepadProps) {
  useScreenFonts()
  const page = useMemo(() => findMesh(room, 'notepad_page'), [room])
  const movers = useMemo(() => {
    const node = room.getObjectByName('notepad')
    return node ? { rig: new FloatRig(node, room.getObjectByName('anchor_notepad_up')), card: new CardPlacer(node) } : null
  }, [room])
  const screen = useCanvasScreen(512, 832, 'notepad')
  const channel = useMemo(() => createNotepadChannel(TAPES), [])
  const material = useMemo(
    () => createLitSurfaceMaterial(screen.texture, { name: 'M_notepad_page', glow: 0.22, roughness: 0.92 }),
    [screen],
  )
  useDisposable(material)
  useEffect(() => startNotepadChannel(screen, channel), [screen, channel])
  useEffect(() => () => movers?.rig.reset(), [movers])

  useFrame((state, delta) => {
    if (!movers) return
    const { route, zoom, reducedMotion, phase } = useStore.getState()
    // Up only on #work itself (zooming into the TV puts it back down), and not
    // before the gate: the still shows it on the desk.
    const raised = !isBootPhase(phase) && route.page === 'work' && zoom === null
    const { width, height } = state.size
    const placed = raised && height > 0 && movers.card.place(state.camera, width / height)
    movers.rig.update(raised, state.clock.elapsedTime, delta, reducedMotion, placed ? movers.card : undefined)
  })

  if (!page) return null
  return <ScreenSurface device="notepad" mesh={page} screen={screen} material={material} />
}
