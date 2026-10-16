/**
 * Sound event bus: interaction code (three objects, DOM UI) calls `sfx('tick')`
 * and never touches Web Audio. The audio engine registers itself as the
 * listener once the app starts (src/audio/wiring.ts).
 */
export type SoundId = 'tick' | 'click' | 'tape' | 'eject' | 'lamp' | 'power' | 'key' | 'static'

type Listener = (id: SoundId) => void

let listener: Listener | null = null

export function sfx(id: SoundId): void {
  listener?.(id)
}

/** Sets the listener; the returned function removes it (if still current). */
export function setSfxListener(next: Listener | null): () => void {
  listener = next
  return () => {
    if (listener === next) listener = null
  }
}
