import { create } from 'zustand'
import { loadMuted } from '../boot/session'
import { STILL_CALIBRATION } from '../boot/still'
import { CAPTURE } from '../capture/mode'
import { TAPE_IDS } from '../content/work'
import { getDeviceProfile, type DeviceProfile } from '../hooks/useDeviceProfile'
import { getReducedMotion } from '../hooks/useReducedMotion'
import type { ScreenDevice } from '../screens/routing'
import type { VcrStatus } from '../three/objects/tapes/deck'
import type { QualityInfo } from '../three/quality/tiers'
import { HOME, parseHash, sameRoute, toHash, type Route } from './router'

/** Boot state machine (boot/machine.ts): loading → gate → entering → live (or fallback without WebGL2). */
export type Phase = 'loading' | 'gate' | 'entering' | 'live' | 'fallback'
export type Zoom = 'tv' | null

/**
 * Loader look: 'still' = public/still.jpg with the OSD on its TV (and the
 * camera lens matched to it until entering); 'free' = a glowing OSD on a dark
 * background (no still / no calibration, ?nostill, data saver).
 */
export type LoaderMode = 'still' | 'free'

/** index.html flags `html.still` when it started loading the still. */
function initialLoaderMode(): LoaderMode {
  const flagged = typeof document !== 'undefined' && document.documentElement.classList.contains('still')
  return flagged && STILL_CALIBRATION !== null ? 'still' : 'free'
}

/** Hit rect under the pointer on a screen (TV/PC/notepad canvas). */
export interface ScreenHover {
  readonly device: ScreenDevice
  readonly id: string
  readonly label: string
}

export interface BackOptions {
  /** At home with no zoom, re-frame the home view (ESC after orbiting away). */
  readonly recenter?: boolean
}

export interface AppState {
  phase: Phase
  /** Displayed loader progress 0..1 (boot/progress.ts), never decreases. */
  progress: number
  loaderMode: LoaderMode
  route: Route
  zoom: Zoom
  /** Hotspot id under the pointer. */
  hovered: string | null
  /** Screen hit rect under the pointer (wins over `hovered` for the tooltip). */
  screenHover: ScreenHover | null
  flying: boolean
  /** Sound off (persisted in localStorage by audio/wiring.ts). */
  muted: boolean
  reducedMotion: boolean
  device: DeviceProfile
  /** Bumped to make the camera re-frame the current view without a route change. */
  recenterNonce: number
  /** Desk lamp (store only, never persisted; ?capture keeps it on). */
  lampOn: boolean
  /** What the VCR holds (tape deck summary, updated on transitions only). */
  vcr: VcrStatus
  /** Adaptive render quality (null until the monitor starts, and in ?capture). */
  quality: QualityInfo | null

  navigate: (hash: string) => void
  setRoute: (route: Route) => void
  setZoom: (zoom: Zoom) => void
  toggleZoom: () => void
  back: (options?: BackOptions) => void
  setHovered: (id: string | null) => void
  setScreenHover: (hover: ScreenHover | null) => void
  setFlying: (flying: boolean) => void
  setPhase: (phase: Phase) => void
  setProgress: (progress: number) => void
  setLoaderMode: (mode: LoaderMode) => void
  setMuted: (muted: boolean) => void
  setReducedMotion: (reducedMotion: boolean) => void
  setDevice: (device: DeviceProfile) => void
  setLampOn: (on: boolean) => void
  toggleLamp: () => void
  setVcr: (vcr: VcrStatus) => void
  setQuality: (quality: QualityInfo | null) => void
}

export const EMPTY_VCR: VcrStatus = { tape: null, state: 'empty' }

const isBrowser = typeof window !== 'undefined'

export const useStore = create<AppState>()((set, get) => ({
  phase: 'loading',
  progress: 0,
  loaderMode: initialLoaderMode(),
  route: isBrowser ? parseHash(window.location.hash, TAPE_IDS) : HOME,
  zoom: null,
  hovered: null,
  screenHover: null,
  flying: false,
  // Muted until the gate says otherwise; returning visitors keep their last choice.
  muted: loadMuted() ?? true,
  reducedMotion: getReducedMotion(),
  device: getDeviceProfile(),
  recenterNonce: 0,
  lampOn: true,
  vcr: EMPTY_VCR,
  quality: null,

  navigate: (hash) => {
    const next = toHash(parseHash(hash, TAPE_IDS))
    if (window.location.hash === next) {
      // Same hash: no hashchange will fire, but zoom still has to clear.
      get().setRoute(parseHash(next, TAPE_IDS))
      return
    }
    window.location.hash = next
  },

  setRoute: (route) =>
    set((state) =>
      sameRoute(state.route, route) ? { zoom: null, screenHover: null } : { route, zoom: null, screenHover: null },
    ),

  setZoom: (zoom) => set({ zoom, screenHover: null }),
  toggleZoom: () => set((state) => ({ zoom: state.zoom === 'tv' ? null : 'tv', screenHover: null })),

  back: ({ recenter = false } = {}) => {
    const { zoom, route, navigate } = get()
    if (zoom !== null) {
      set({ zoom: null, screenHover: null })
    } else if (route.page !== 'home') {
      navigate('#home')
    } else if (recenter) {
      set((state) => ({ recenterNonce: state.recenterNonce + 1 }))
    }
  },

  setHovered: (hovered) => set({ hovered }),
  setScreenHover: (hover) =>
    set((state) => {
      const current = state.screenHover
      const same =
        current === hover ||
        (current !== null && hover !== null && current.device === hover.device && current.id === hover.id)
      return same ? state : { screenHover: hover }
    }),
  setFlying: (flying) => set({ flying }),
  setPhase: (phase) => set({ phase }),
  setProgress: (progress) =>
    set((state) => {
      const next = Math.max(state.progress, Math.min(1, Math.max(0, progress)))
      return next === state.progress ? state : { progress: next }
    }),
  setLoaderMode: (loaderMode) => set({ loaderMode }),
  setMuted: (muted) => set({ muted }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setDevice: (device) => set({ device }),
  // The still is always captured with the lamp on.
  setLampOn: (on) => set({ lampOn: CAPTURE || on }),
  toggleLamp: () => get().setLampOn(!get().lampOn),
  setVcr: (vcr) =>
    set((state) => (state.vcr.tape === vcr.tape && state.vcr.state === vcr.state ? state : { vcr })),
  setQuality: (quality) => set({ quality }),
}))
