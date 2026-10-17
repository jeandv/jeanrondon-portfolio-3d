import { createPortal, useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, MeshBasicMaterial, type Mesh, type Object3D } from 'three'
import { musicNow } from '../../audio/music/clock'
import { sfx } from '../../audio/sfx'
import { CD_LCD_SIZE, createCdLcdChannel, type CdLcdHooks } from '../../screens/channels/cd/lcd'
import { useScreenFonts } from '../../screens/fonts'
import { useStore, type AppState } from '../../state/store'
import { DRAG_THRESHOLD } from '../interaction/hotspots'
import { CdDriver, meshOf } from './cd/driver'
import { ScreenSurface } from './ScreenSurface'
import { createScreenRaycast } from './screenRuntime'
import { useCanvasScreen, useDisposable } from './useScreen'

/** The backlit LCD stays under the bloom threshold (it glows, it does not flare). */
const LCD_TINT = new Color('#c4c4c4')

const LCD_HOOKS: CdLcdHooks = {
  view: () => {
    const { cd, muted } = useStore.getState()
    return { cd, muted }
  },
  now: musicNow,
  press: (button) => useStore.getState().cdAction(button === 'play' ? 'toggle' : button),
  playTrack: (index) => useStore.getState().cdPlayTrack(index),
}

const PROXY_USER_DATA = { hotspotProxy: true, screenProxy: true } as const

/** The lid answers the pointer only in the close-up (outside it, the whole player is one hotspot). */
function lidActive(state: AppState): boolean {
  return state.phase === 'live' && state.zoom === 'cd' && !state.creditsOpen && !state.calcUp
}

const lidLabel = (state: AppState) => (state.cd.lid === 'open' ? 'CLOSE LID' : 'OPEN LID')

interface LidProxyProps {
  /** The lid, or the disc (seen through the lid's window, or bare with the lid open). */
  readonly target: Mesh
}

/**
 * A proxy on the lid's (or the disc's) own geometry, slightly closer than the
 * player's hotspot box, so it wins in the close-up: a click opens / shuts the lid.
 */
function LidProxy({ target }: LidProxyProps) {
  const raycast = useMemo(() => createScreenRaycast(target, () => lidActive(useStore.getState())), [target])
  const hover = () => {
    const state = useStore.getState()
    if (state.screenHover?.device !== 'cd' || state.screenHover.id !== 'lid') sfx('tick')
    state.setScreenHover({ device: 'cd', id: 'lid', label: lidLabel(state) })
  }
  const onPointerOut = () => {
    const state = useStore.getState()
    if (state.screenHover?.device === 'cd' && state.screenHover.id === 'lid') state.setScreenHover(null)
  }
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > DRAG_THRESHOLD) return
    event.stopPropagation()
    sfx('lid')
    const state = useStore.getState()
    state.cdAction('lid')
    // Same hit, new label (OPEN ↔ CLOSE).
    state.setScreenHover(null)
    hover()
  }
  return createPortal(
    <mesh raycast={raycast} userData={PROXY_USER_DATA} onPointerMove={hover} onPointerOut={onPointerOut} onClick={onClick}>
      <meshBasicMaterial visible={false} />
    </mesh>,
    target,
  )
}

export interface CdPlayerProps {
  readonly room: Object3D
}

/**
 * The CD player (`cd_player`, key M or a click: the close-up). Its LCD strip
 * (`cd_display`) is a canvas screen with the play / pause / next / previous
 * buttons as hit rects; the lid opens on a click (close-up only) and the disc
 * spins while it plays. The music itself lives in src/audio/music (it keeps
 * playing when you leave the close-up). Suspends until the screen fonts are in.
 */
export function CdPlayer({ room }: CdPlayerProps) {
  useScreenFonts()
  const display = useMemo(() => meshOf(room.getObjectByName('cd_display')), [room])
  const lid = useMemo(() => meshOf(room.getObjectByName('cd_lid')), [room])
  const disc = useMemo(() => meshOf(room.getObjectByName('cd_disc')), [room])
  const driver = useMemo(() => CdDriver.create(room), [room])
  const screen = useCanvasScreen(CD_LCD_SIZE.width, CD_LCD_SIZE.height, 'cd')
  const channel = useMemo(() => createCdLcdChannel(LCD_HOOKS), [])
  const material = useMemo(() => new MeshBasicMaterial({ name: 'M_cd_display', map: screen.texture, color: LCD_TINT }), [screen])
  useDisposable(material)

  useEffect(() => {
    screen.switchTo(channel, { transition: 'cut' })
    // Redraw on any change of the player or the mute flag (keys, other tabs of the UI).
    return useStore.subscribe((state, previous) => {
      if (state.cd !== previous.cd || state.muted !== previous.muted) screen.invalidate()
    })
  }, [screen, channel])
  useEffect(() => driver?.start(), [driver])

  useFrame((_, delta) => {
    // The disc rolls into its next track on its own; the store follows (a no-op mid-track).
    useStore.getState().settleCd()
    driver?.frame(delta)
  })

  return (
    <>
      {display && <ScreenSurface device="cd" mesh={display} screen={screen} material={material} />}
      {lid && <LidProxy target={lid} />}
      {disc && <LidProxy target={disc} />}
    </>
  )
}
