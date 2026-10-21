import { browserStorage, type StorageLike } from '../boot/session'

/**
 * The one music volume (0–100) both discs share: the generated lo-fi (a gain
 * on the music bus) and the YouTube player (`setVolume`). Persisted in
 * localStorage; every access is wrapped (privacy modes throw). SOUND OFF is
 * separate: it mutes everything without touching this.
 */

export const VOLUME_KEY = 'jr3d:volume'
export const DEFAULT_VOLUME = 60
/** One press of VOL− / VOL+ (and one LCD bar segment). */
export const VOLUME_STEP = 10
export const VOLUME_SEGMENTS = 10

export function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.round(Math.min(100, Math.max(0, volume))) : DEFAULT_VOLUME
}

/** VOL− / VOL+ by `steps` (±1), snapping to the 10-step grid. */
export function stepVolume(volume: number, steps: number): number {
  const snapped = Math.round(clampVolume(volume) / VOLUME_STEP) * VOLUME_STEP
  return clampVolume(snapped + steps * VOLUME_STEP)
}

/** Lit bar segments (0–10) on the LCD. */
export function volumeSegments(volume: number): number {
  return Math.round((clampVolume(volume) / 100) * VOLUME_SEGMENTS)
}

/** Linear gain of the generated music for a volume (a perceptual curve; 0 is silent, 100 is the mixed level). */
export function musicGain(volume: number): number {
  return (clampVolume(volume) / 100) ** 1.6
}

export function loadVolume(storage: StorageLike | null = browserStorage('local')): number {
  try {
    const value = storage?.getItem(VOLUME_KEY)
    if (value === null || value === undefined || value.trim() === '') return DEFAULT_VOLUME
    return clampVolume(Number(value))
  } catch {
    return DEFAULT_VOLUME
  }
}

export function saveVolume(volume: number, storage: StorageLike | null = browserStorage('local')): void {
  try {
    storage?.setItem(VOLUME_KEY, String(clampVolume(volume)))
  } catch {
    // Quota or privacy mode: the level just is not remembered.
  }
}
