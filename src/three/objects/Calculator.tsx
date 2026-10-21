import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Vector3, type Mesh, type Object3D } from 'three'
import { isBootPhase } from '../../boot/machine'
import { CAPTURE, CAPTURE_SCREEN_TIME } from '../../capture/mode'
import type { CanvasScreen } from '../../screens/CanvasScreen'
import { createDisplayChannel, DISPLAY_SIZE } from '../../screens/channels/calc/display'
import { createKeypadChannel, KEYPAD_SIZE } from '../../screens/channels/calc/keypad'
import { useScreenFonts } from '../../screens/fonts'
import { useStore } from '../../state/store'
import { CardPlacer, heldCalculatorLayout } from '../camera/workLayout'
import { createLitSurfaceMaterial } from '../materials/litSurface'
import { meshOf, nodeSpaceBounds } from './bounds'
import { FloatRig } from './motion'
import { ScreenSurface } from './ScreenSurface'
import { isInView, swapMaterial } from './screenRuntime'
import { useCanvasScreen, useDisposable } from './useScreen'

/** The held calculator barely sways: you aim at its keys. */
const HELD_SWAY = 0.3

/** A canvas surface without input (the LCD): swaps its material in and ticks it (2 fps off-camera). */
function useScreenTick(screen: CanvasScreen, mesh: Mesh | null, material: ReturnType<typeof createLitSurfaceMaterial>): void {
  useEffect(() => (mesh ? swapMaterial(mesh, material) : undefined), [mesh, material])
  useFrame((state) => {
    if (!mesh) return
    screen.setVisible(isInView(mesh, state.camera))
    screen.update(CAPTURE ? CAPTURE_SCREEN_TIME : state.clock.elapsedTime)
  })
}

export interface CalculatorProps {
  readonly room: Object3D
}

/**
 * The desk calculator (`calculator`): a click lifts it to a camera-relative
 * pose facing the camera (the same placer as the notepad and the CV
 * card) and it works: its keys (`calc_keys`, canvas hit rects) or the
 * physical keyboard type into the pure engine (calc/engine.ts, state in the
 * store) and the LCD (`calc_display`) shows the result. Esc clears, then puts
 * it down; so does a click anywhere else. Reduced motion: no float, a cut.
 */
export function Calculator({ room }: CalculatorProps) {
  useScreenFonts()
  const keysMesh = useMemo(() => meshOf(room.getObjectByName('calc_keys')), [room])
  const displayMesh = useMemo(() => meshOf(room.getObjectByName('calc_display')), [room])
  const movers = useMemo(() => {
    const node = room.getObjectByName('calculator')
    if (!node) return null
    // Held by its own size (its LCD and keypad planes lie on its face, so this is the body's box).
    const box = nodeSpaceBounds(node)
    const size = box.isEmpty() ? undefined : box.getSize(new Vector3())
    return { rig: new FloatRig(node, undefined, { sway: HELD_SWAY }), card: new CardPlacer(node, heldCalculatorLayout, size) }
  }, [room])

  const keypad = useCanvasScreen(KEYPAD_SIZE.width, KEYPAD_SIZE.height, 'calc_keys')
  const lcd = useCanvasScreen(DISPLAY_SIZE.width, DISPLAY_SIZE.height, 'calc_display')
  const keypadChannel = useMemo(() => createKeypadChannel({ press: (key) => useStore.getState().calcInput(key) }), [])
  const lcdChannel = useMemo(() => createDisplayChannel({ state: () => useStore.getState().calc }), [])
  const keypadMaterial = useMemo(
    () => createLitSurfaceMaterial(keypad.texture, { name: 'M_calc_keys', glow: 0.32, roughness: 0.6 }),
    [keypad],
  )
  const lcdMaterial = useMemo(
    () => createLitSurfaceMaterial(lcd.texture, { name: 'M_calc_display', glow: 0.42, roughness: 0.45 }),
    [lcd],
  )
  useDisposable(keypadMaterial)
  useDisposable(lcdMaterial)
  useScreenTick(lcd, displayMesh, lcdMaterial)

  useEffect(() => {
    keypad.switchTo(keypadChannel, { transition: 'cut' })
    lcd.switchTo(lcdChannel, { transition: 'cut' })
    return useStore.subscribe((state, previous) => {
      if (state.calc !== previous.calc) lcd.invalidate()
    })
  }, [keypad, lcd, keypadChannel, lcdChannel])
  useEffect(() => () => movers?.rig.reset(), [movers])

  useFrame((state, delta) => {
    if (!movers) return
    const { calcUp, reducedMotion, phase } = useStore.getState()
    const raised = calcUp && !isBootPhase(phase)
    const { width, height } = state.size
    const placed = raised && height > 0 && movers.card.place(state.camera, width / height)
    movers.rig.update(raised, state.clock.elapsedTime, delta, reducedMotion, placed ? movers.card : undefined)
  })

  if (!keysMesh) return null
  return <ScreenSurface device="calculator" mesh={keysMesh} screen={keypad} material={keypadMaterial} clickSound="calc" />
}
