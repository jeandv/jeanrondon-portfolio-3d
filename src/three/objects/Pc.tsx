import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { useScreenFonts } from '../../screens/fonts'
import { createCrtMaterial, CRT_PRESETS, setCrtTime } from '../materials/crtScreen'
import { ScreenSurface } from './ScreenSurface'
import { startPcChannels } from './screenChannels'
import { findMesh } from './screenRuntime'
import { useCanvasScreen, useDisposable } from './useScreen'

export interface PcProps {
  readonly room: Object3D
}

/** Old PC monitor on `pc_screen` (800×600, green phosphor): `C:\>_`, About pager, contact BBS. */
export function Pc({ room }: PcProps) {
  useScreenFonts()
  const mesh = useMemo(() => findMesh(room, 'pc_screen'), [room])
  const screen = useCanvasScreen(800, 600, 'pc')
  const material = useMemo(() => createCrtMaterial(screen.texture, CRT_PRESETS.pc, 'M_pc_screen'), [screen])
  useDisposable(material)
  useEffect(() => startPcChannels(screen), [screen])

  if (!mesh) return null
  return (
    <ScreenSurface
      device="pc"
      mesh={mesh}
      screen={screen}
      material={material}
      onFrame={(seconds) => setCrtTime(material, seconds)}
    />
  )
}
