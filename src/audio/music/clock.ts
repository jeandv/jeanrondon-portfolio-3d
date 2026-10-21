/**
 * The clock the CD player runs on (s). The audio wiring points it at the
 * AudioContext's own clock once it exists, so the disc stops with the sound
 * when a hidden tab suspends the context; before that (or without Web Audio)
 * it falls back to performance.now().
 */

type Clock = () => number

const fallback: Clock = () => (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000

let source: Clock = fallback

export function musicNow(): number {
  return source()
}

/** Sets the clock; the returned function restores the fallback (if still current). */
export function setMusicClock(next: Clock): () => void {
  source = next
  return () => {
    if (source === next) source = fallback
  }
}
