import { useEffect, useMemo } from 'react'
import type { Object3D } from 'three'
import { useScreenFonts } from '../../screens/fonts'
import { createCrtMaterial, CRT_PRESETS, setCrtTime } from '../materials/crtScreen'
import { ScreenSurface } from './ScreenSurface'
import { startTvChannels } from './screenChannels'
import { findMesh } from './screenRuntime'
import { useCanvasScreen, useDisposable } from './useScreen'

export interface TvProps {
  readonly room: Object3D
}

/** CRT TV on `tv_screen` (640×480): boot, title card, INSERT TAPE, tapes. */
export function Tv({ room }: TvProps) {
  useScreenFonts()
  const mesh = useMemo(() => findMesh(room, 'tv_screen'), [room])
  const screen = useCanvasScreen(640, 480, 'tv')
  const material = useMemo(() => createCrtMaterial(screen.texture, CRT_PRESETS.tv, 'M_tv_screen'), [screen])
  useDisposable(material)
  useEffect(() => startTvChannels(screen), [screen])

  if (!mesh) return null
  return (
    <ScreenSurface
      device="tv"
      mesh={mesh}
      screen={screen}
      material={material}
      onFrame={(seconds) => setCrtTime(material, seconds)}
    />
  )
}
