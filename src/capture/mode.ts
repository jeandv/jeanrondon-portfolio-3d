/**
 * `?capture` (dev only): the mode scripts/capture-still.mjs renders the loader
 * still in. No UI chrome and no gate (straight to live on the home frame),
 * the TV on its `home` channel, and every clock frozen so the frame is
 * deterministic: film grain, rain, city lights and the CRT flicker.
 */
export const CAPTURE: boolean =
  import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('capture')

/** Window shader clock (s): a moment with beacons lit and cars on the roads. */
export const CAPTURE_CITY_TIME = 41.3

/** Screen / CRT clock (s). */
export const CAPTURE_SCREEN_TIME = 2

/** Frames rendered on the live home view before the capture is declared ready. */
export const CAPTURE_SETTLE_FRAMES = 12

export interface CaptureApi {
  /** Resolves once the home view is live, compiled and settled. */
  readonly ready: Promise<void>
  /** Projected `tv_screen` corners in CSS px: top-left, top-right, bottom-right, bottom-left. */
  tvCorners(): Array<{ x: number; y: number }>
  /** Vertical FOV (deg) of the camera. */
  fov(): number
}

declare global {
  interface Window {
    __capture?: CaptureApi
  }
}
