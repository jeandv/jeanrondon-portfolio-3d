import { createPortal, useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Material, Mesh } from 'three'
import { sfx } from '../../audio/sfx'
import { CAPTURE, CAPTURE_SCREEN_TIME } from '../../capture/mode'
import type { CanvasScreen } from '../../screens/CanvasScreen'
import { uvToCanvas, type HitRect } from '../../screens/hit'
import { registerScreenKeys } from '../../screens/input'
import { isInteractive, type ScreenDevice } from '../../screens/routing'
import { useStore } from '../../state/store'
import { DRAG_THRESHOLD } from '../interaction/hotspots'
import { createScreenRaycast, isInView, swapMaterial } from './screenRuntime'

/** Proxies are skipped by materials, framing and hotspot bounds. */
const PROXY_USER_DATA = { hotspotProxy: true, screenProxy: true } as const

function hitUnder(event: ThreeEvent<PointerEvent | MouseEvent>, screen: CanvasScreen): HitRect | null {
  if (!event.uv) return null
  const point = uvToCanvas(event.uv, screen.width, screen.height)
  return screen.hitAt(point.x, point.y)
}

function clearScreenHover(device: ScreenDevice): void {
  const state = useStore.getState()
  if (state.screenHover?.device === device) state.setScreenHover(null)
}

export interface ScreenSurfaceProps {
  readonly device: ScreenDevice
  /** GLB screen mesh (UV0 0..1, glTF orientation). */
  readonly mesh: Mesh
  readonly screen: CanvasScreen
  readonly material: Material
  /** Per-frame hook (e.g. shader clock), seconds. */
  readonly onFrame?: (seconds: number) => void
}

/**
 * Binds a CanvasScreen to a GLB mesh: swaps in its material, ticks it every
 * frame (2 fps when off-camera), forwards keys, and maps pointer UVs to the
 * channel's hit rects through an invisible proxy.
 */
export function ScreenSurface({ device, mesh, screen, material, onFrame }: ScreenSurfaceProps) {
  useEffect(() => swapMaterial(mesh, material), [mesh, material])
  useEffect(() => registerScreenKeys(device, (key) => screen.key(key)), [device, screen])
  useEffect(() => () => clearScreenHover(device), [device])

  useFrame((state) => {
    // ?capture freezes the screen clocks so the still is deterministic.
    const seconds = CAPTURE ? CAPTURE_SCREEN_TIME : state.clock.elapsedTime
    screen.setReducedMotion(useStore.getState().reducedMotion)
    screen.setVisible(isInView(mesh, state.camera))
    screen.update(seconds)
    onFrame?.(seconds)
  })

  const raycast = useMemo(
    () =>
      createScreenRaycast(mesh, () => {
        const state = useStore.getState()
        // The credits card covers the screens while it is up.
        return state.phase === 'live' && !state.creditsOpen && isInteractive(device, state)
      }),
    [mesh, device],
  )

  // Hover never stops propagation (the hotspot behind keeps its own hover state);
  // a click on a hit rect does, so the hotspot behind does not fire too.
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    const hit = hitUnder(event, screen)
    screen.setHover(hit?.id ?? null)
    if (!hit) {
      clearScreenHover(device)
      return
    }
    const state = useStore.getState()
    if (state.screenHover?.device !== device || state.screenHover.id !== hit.id) sfx('tick')
    state.setScreenHover({ device, id: hit.id, label: hit.label ?? hit.id.toUpperCase() })
  }
  const onPointerOut = () => {
    screen.setHover(null)
    clearScreenHover(device)
  }
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > DRAG_THRESHOLD) return
    const hit = hitUnder(event, screen)
    if (!hit) return
    event.stopPropagation()
    sfx('click')
    screen.press(hit.id)
  }

  return createPortal(
    <mesh
      raycast={raycast}
      userData={PROXY_USER_DATA}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onClick={onClick}
    >
      <meshBasicMaterial visible={false} />
    </mesh>,
    mesh,
  )
}
