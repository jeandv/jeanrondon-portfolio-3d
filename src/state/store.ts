import { create } from 'zustand'
import { TAPE_IDS } from '../content/work'
import { getDeviceProfile, type DeviceProfile } from '../hooks/useDeviceProfile'
import { getReducedMotion } from '../hooks/useReducedMotion'
import type { ScreenDevice } from '../screens/routing'
import { HOME, parseHash, sameRoute, toHash, type Route } from './router'

/** Boot state machine: loading → gate → entering → live (or fallback without WebGL2). */
export type Phase = 'loading' | 'gate' | 'entering' | 'live' | 'fallback'
export type Zoom = 'tv' | null

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
  /** Download progress 0..1, never decreases (M5 loader). */
  progress: number
  route: Route
  zoom: Zoom
  /** Hotspot id under the pointer. */
  hovered: string | null
  /** Screen hit rect under the pointer (wins over `hovered` for the tooltip). */
  screenHover: ScreenHover | null
  flying: boolean
  muted: boolean
  reducedMotion: boolean
  device: DeviceProfile
  /** Bumped to make the camera re-frame the current view without a route change. */
  recenterNonce: number

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
  setMuted: (muted: boolean) => void
  setReducedMotion: (reducedMotion: boolean) => void
  setDevice: (device: DeviceProfile) => void
}

const isBrowser = typeof window !== 'undefined'

export const useStore = create<AppState>()((set, get) => ({
  phase: 'loading',
  progress: 0,
  route: isBrowser ? parseHash(window.location.hash, TAPE_IDS) : HOME,
  zoom: null,
  hovered: null,
  screenHover: null,
  flying: false,
  muted: true,
  reducedMotion: getReducedMotion(),
  device: getDeviceProfile(),
  recenterNonce: 0,

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
    set((state) => ({ progress: Math.max(state.progress, Math.min(1, Math.max(0, progress))) })),
  setMuted: (muted) => set({ muted }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setDevice: (device) => set({ device }),
}))
