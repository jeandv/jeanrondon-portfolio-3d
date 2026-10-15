import { useEffect, useMemo } from 'react'
import type { CanvasScreen } from '../../screens/CanvasScreen'
import { createCanvasScreen } from './screenRuntime'

/** A CanvasScreen owned by the calling component (texture disposed on unmount). */
export function useCanvasScreen(width: number, height: number, name: string): CanvasScreen {
  const screen = useMemo(() => createCanvasScreen(width, height, name), [width, height, name])
  useEffect(() => () => screen.dispose(), [screen])
  return screen
}

/** Disposes a GPU resource when the component unmounts or the resource changes. */
export function useDisposable(resource: { dispose(): void } | null): void {
  useEffect(() => () => resource?.dispose(), [resource])
}
