import { use } from 'react'

/**
 * Canvas font stacks. The families are the names registered by the
 * @fontsource CSS imported in main.tsx; screens never draw before they load
 * (plan §12: "fuentes que cargan tarde en el canvas").
 */
export const FONT = {
  osd: "'VT323'",
  hand: "'Caveat Variable'",
  mono: "'JetBrains Mono Variable'",
  ui: "'Archivo Variable'",
} as const

/** CSS `font` shorthand for a canvas context. */
export function font(weight: number, size: number, family: string): string {
  return `${weight} ${Math.round(size)}px ${family}`
}

/** Every face the screens draw with (weight + family). */
export const SCREEN_FACES: readonly string[] = [
  font(400, 32, FONT.osd),
  font(600, 32, FONT.hand),
  font(400, 32, FONT.mono),
  font(700, 32, FONT.mono),
  font(900, 32, FONT.ui),
]

/** Latin text so the latin unicode-range subset is the one requested. */
const SAMPLE = 'AaÓó09'

let ready = false
let pending: Promise<void> | null = null

/**
 * Loads every screen face once (cached promise). Resolves even on failure so
 * the scene never hangs; a missing face is reported in dev.
 */
export function loadScreenFonts(): Promise<void> {
  if (pending) return pending
  if (typeof document === 'undefined' || !('fonts' in document)) {
    ready = true
    pending = Promise.resolve()
    return pending
  }
  pending = Promise.all(SCREEN_FACES.map((face) => document.fonts.load(face, SAMPLE)))
    .then(
      (results) => {
        if (!import.meta.env.DEV) return
        results.forEach((faces, i) => {
          if (faces.length === 0) console.warn(`[fonts] no @font-face matched "${SCREEN_FACES[i]}"`)
        })
      },
      (error: unknown) => console.warn('[fonts] screen fonts failed to load', error),
    )
    .then(() => {
      ready = true
    })
  return pending
}

/** True once `loadScreenFonts()` settled; CanvasScreen refuses to draw before. */
export function screenFontsReady(): boolean {
  return ready
}

/** Suspends the calling component until the screen fonts are loaded. */
export function useScreenFonts(): void {
  use(loadScreenFonts())
}
