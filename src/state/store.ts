import { create } from 'zustand'
import { musicNow } from '../audio/music/clock'
import type { DiscId } from '../audio/music/discs'
import { STOPPED_SNAPSHOT, type SourceSnapshot } from '../audio/music/source'
import { TRACK_SECONDS } from '../audio/music/tracks'
import { clampVolume, loadVolume } from '../audio/volume'
import { loadMuted } from '../boot/session'
import { STILL_CALIBRATION } from '../boot/still'
import { CAPTURE } from '../capture/mode'
import { TAPE_IDS } from '../content/work'
import { getDeviceProfile, type DeviceProfile } from '../hooks/useDeviceProfile'
import { getReducedMotion } from '../hooks/useReducedMotion'
import type { BbsStatus } from '../screens/channels/pc/dialup'
import type { ScreenDevice } from '../screens/routing'
import { CALC_RESET, calcPress, type CalcKey, type CalcState } from '../three/objects/calc/engine'
import { CD_STOPPED, cdPress, closeLid, playTrack, settle, type CdAction, type CdState } from '../three/objects/cd/player'
import { BATTERY_IN, toggleBattery, type ClockBattery } from '../three/objects/clock/battery'
import { fullCup, maybeRefill, takeSip, type CupState } from '../three/objects/coffee/cup'
import { nextLed, type LedId } from '../three/objects/decor/lights'
import type { VcrStatus } from '../three/objects/tapes/deck'
import type { QualityInfo } from '../three/quality/tiers'
import { HOME, parseHash, sameRoute, toHash, type Route } from './router'

/** Boot state machine (boot/machine.ts): loading → gate → entering → live (or fallback without WebGL2). */
export type Phase = 'loading' | 'gate' | 'entering' | 'live' | 'fallback'
/**
 * Camera modes on top of the route (not routes: the URL keeps the page):
 * the TV close-up (Z) and the CD player close-up (M).
 */
export type Zoom = 'tv' | 'cd' | null

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
  /** The PC's BBS on #online: dialing (skippable), at the menu, or not on screen. */
  bbs: BbsStatus
  /** The coffee mug (5 sips, refills after a while; never persisted). */
  cup: CupState
  /** The wall clock's battery (never persisted). */
  clock: ClockBattery
  /** The credits card is floating in front of the camera. */
  creditsOpen: boolean
  /** The CD player (lid, play state, track; times on the music clock). Never autoplays. */
  cd: CdState
  /** The calculator is held up in front of the camera. */
  calcUp: boolean
  /** What the calculator holds and shows. */
  calc: CalcState
  /** The disc in the CD player: 1 the generated lo-fi (`cd` is its transport), 2 Joji on YouTube (`yt`). */
  disc: DiscId
  /** The Joji disc's YouTube player as the LCD and the monitor need it (src/audio/youtube/adapter.ts). */
  yt: SourceSnapshot
  /** Music volume 0–100, shared by both discs (persisted by audio/wiring.ts). */
  volume: number
  /** The LED strip behind the desk (store only; ?capture keeps it violet). */
  led: LedId

  navigate: (hash: string) => void
  setRoute: (route: Route) => void
  setZoom: (zoom: Zoom) => void
  /** Z: toggles the TV close-up. */
  toggleZoom: () => void
  /** M: toggles the CD player close-up. */
  toggleCdView: () => void
  /** A CD player button (play, pause, next, lid...). */
  cdAction: (action: CdAction, now?: number) => void
  cdPlayTrack: (index: number, now?: number) => void
  /** Follows the disc into its next track (a no-op until a track ends). */
  settleCd: (now?: number) => void
  setCalcUp: (up: boolean) => void
  toggleCalc: () => void
  calcInput: (key: CalcKey) => void
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
  setBbs: (bbs: BbsStatus) => void
  /** One sip (ignored when empty or mid-sip). */
  sipCoffee: (now?: number) => void
  /** Refills an empty cup once its refill is due. */
  refillCup: (now?: number) => void
  toggleClockBattery: (now?: number) => void
  setCreditsOpen: (open: boolean) => void
  toggleCredits: () => void
  setDisc: (disc: DiscId) => void
  setYt: (yt: SourceSnapshot) => void
  setVolume: (volume: number) => void
  /** Click on the LED strip: violet → teal → amber → off → violet. */
  cycleLed: () => void
}

export const EMPTY_VCR: VcrStatus = { tape: null, state: 'empty' }

const isBrowser = typeof window !== 'undefined'

/**
 * Leaving a close-up: the CD lid shuts behind you (it never stays open where
 * a tape or the credits card could fly through it), the calculator and the
 * credits card go back.
 */
function leaveView(state: AppState, zoom: Zoom): Partial<AppState> {
  return {
    zoom,
    screenHover: null,
    creditsOpen: false,
    calcUp: false,
    cd: zoom === 'cd' ? state.cd : closeLid(state.cd),
  }
}

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
  bbs: 'off',
  cup: fullCup(Date.now()),
  clock: BATTERY_IN,
  creditsOpen: false,
  cd: CD_STOPPED,
  calcUp: false,
  calc: CALC_RESET,
  disc: 'tapes',
  yt: STOPPED_SNAPSHOT,
  volume: loadVolume(),
  led: 'violet',

  navigate: (hash) => {
    const next = toHash(parseHash(hash, TAPE_IDS))
    if (window.location.hash === next) {
      // Same hash: no hashchange will fire, but zoom still has to clear.
      get().setRoute(parseHash(next, TAPE_IDS))
      return
    }
    window.location.hash = next
  },

  // Any navigation puts the credits card and the calculator back and leaves a close-up.
  setRoute: (route) =>
    set((state) => (sameRoute(state.route, route) ? leaveView(state, null) : { route, ...leaveView(state, null) })),

  setZoom: (zoom) => set((state) => leaveView(state, zoom)),
  toggleZoom: () => set((state) => leaveView(state, state.zoom === 'tv' ? null : 'tv')),
  toggleCdView: () => set((state) => leaveView(state, state.zoom === 'cd' ? null : 'cd')),

  back: ({ recenter = false } = {}) => {
    const { zoom, route, navigate, creditsOpen, calcUp } = get()
    if (creditsOpen) {
      set({ creditsOpen: false })
    } else if (calcUp) {
      set({ calcUp: false, screenHover: null })
    } else if (zoom !== null) {
      set((state) => leaveView(state, null))
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
  setBbs: (bbs) => set((state) => (state.bbs === bbs ? state : { bbs })),
  sipCoffee: (now = Date.now()) =>
    set((state) => {
      const cup = takeSip(maybeRefill(state.cup, now), now)
      return cup === state.cup ? state : { cup }
    }),
  refillCup: (now = Date.now()) =>
    set((state) => {
      const cup = maybeRefill(state.cup, now)
      return cup === state.cup ? state : { cup }
    }),
  toggleClockBattery: (now = Date.now()) => set((state) => ({ clock: toggleBattery(state.clock, now) })),
  // The still is always captured with the card filed away; one thing in hand at a time.
  setCreditsOpen: (open) =>
    set((state) => ({ creditsOpen: !CAPTURE && open, calcUp: open ? false : state.calcUp, screenHover: null })),
  toggleCredits: () => get().setCreditsOpen(!get().creditsOpen),
  // ?capture keeps the CD closed and stopped.
  cdAction: (action, now = musicNow()) =>
    set((state) => {
      if (CAPTURE) return state
      const cd = cdPress(state.cd, action, TRACK_SECONDS, now)
      return cd === state.cd ? state : { cd }
    }),
  cdPlayTrack: (index, now = musicNow()) =>
    set((state) => (CAPTURE ? state : { cd: playTrack(state.cd, index, TRACK_SECONDS, now) })),
  settleCd: (now = musicNow()) =>
    set((state) => {
      const cd = settle(state.cd, TRACK_SECONDS, now)
      return cd === state.cd ? state : { cd }
    }),
  setCalcUp: (up) =>
    set((state) => ({ calcUp: !CAPTURE && up, creditsOpen: up ? false : state.creditsOpen, screenHover: null })),
  toggleCalc: () => get().setCalcUp(!get().calcUp),
  calcInput: (key) =>
    set((state) => {
      const calc = calcPress(state.calc, key)
      return calc === state.calc ? state : { calc }
    }),
  setDisc: (disc) => set((state) => (CAPTURE || state.disc === disc ? state : { disc })),
  setYt: (yt) =>
    set((state) =>
      state.yt.status === yt.status && state.yt.track === yt.track && state.yt.error === yt.error ? state : { yt },
    ),
  setVolume: (volume) => set((state) => (clampVolume(volume) === state.volume ? state : { volume: clampVolume(volume) })),
  cycleLed: () => set((state) => (CAPTURE ? state : { led: nextLed(state.led) })),
}))
