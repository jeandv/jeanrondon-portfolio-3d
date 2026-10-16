import { sfx } from '../../audio/sfx'
import { isBootPhase } from '../../boot/machine'
import { CAPTURE } from '../../capture/mode'
import type { CanvasScreen } from '../../screens/CanvasScreen'
import type { NotepadChannel } from '../../screens/channels/notepad/work'
import { createPcChannel } from '../../screens/channels/pc'
import { createBootChannel, createTvChannel } from '../../screens/channels/tv'
import { pcChannelFor, sameTvChannel, tvChannelFor, tvChannelForDeck, type TvChannelKey } from '../../screens/routing'
import { HOME, type Route } from '../../state/router'
import { useStore, type Phase } from '../../state/store'
import type { VcrStatus } from './tapes/deck'

/**
 * Delay (s) after the gate before the TV leaves its "CH 03" boot screen: the
 * DOM OSD's static burst covers the glass meanwhile.
 */
export const TV_BOOT_HOLD_SECONDS = 0.3

function onRouteChange(listener: (route: Route) => void): () => void {
  return useStore.subscribe((state, previous) => {
    if (state.route !== previous.route) listener(state.route)
  })
}

/** Static burst (ms) between a tape clicking into the VCR and its picture. */
export const INSERT_STATIC_MS = 150

/** The playing tape, for the TV (a tape still flying or ejecting does not count). */
function playingTape(vcr: VcrStatus): string | null {
  return vcr.state === 'playing' ? vcr.tape : null
}

/**
 * TV: the boot OSD while loading / at the gate, then the route's channel
 * (static between channels). A tape channel waits for the deck: INSERT TAPE
 * while the tape flies into the VCR, then a short static burst lands the tape
 * ~150 ms after it clicks in. ?capture cuts straight to the route's channel.
 * Returns the cleanup.
 */
export function startTvChannels(screen: CanvasScreen): () => void {
  let booted = false
  let timer = 0
  let shown: TvChannelKey | null = null
  const channelOf = (state: { readonly route: Route; readonly vcr: VcrStatus }) =>
    tvChannelForDeck(state.route, playingTape(state.vcr))
  const show = (key: TvChannelKey, ms?: number) => {
    shown = key
    screen.switchTo(createTvChannel(key), ms === undefined ? undefined : { ms })
  }

  const boot = () => {
    if (booted || timer) return
    const hold = useStore.getState().reducedMotion ? 0 : TV_BOOT_HOLD_SECONDS
    timer = window.setTimeout(() => {
      booted = true
      show(channelOf(useStore.getState()))
    }, hold * 1000)
  }

  if (CAPTURE) {
    booted = true
    shown = tvChannelFor(useStore.getState().route)
    screen.switchTo(createTvChannel(shown), { transition: 'cut' })
  } else {
    screen.switchTo(createBootChannel(), { transition: 'cut' })
    if (!isBootPhase(useStore.getState().phase)) boot()
  }

  const unsubscribe = useStore.subscribe((state, previous) => {
    if (!booted && !isBootPhase(state.phase)) boot()
    if (!booted || CAPTURE || (state.route === previous.route && state.vcr === previous.vcr)) return
    const next = channelOf(state)
    if (shown && sameTvChannel(shown, next)) return
    sfx('static')
    // A tape that just clicked in: a short burst. Anything else: the usual static.
    const inserted = next.kind === 'tape' && state.vcr !== previous.vcr && state.route === previous.route
    show(next, inserted ? INSERT_STATIC_MS : undefined)
  })
  return () => {
    window.clearTimeout(timer)
    unsubscribe()
  }
}

/** The route the PC follows: idle before the gate, so a deep-linked pager types once the camera gets there. */
function pcRoute({ phase, route }: { readonly phase: Phase; readonly route: Route }): Route {
  return isBootPhase(phase) ? HOME : route
}

/** PC: idle / about pager / contact menu per route. */
export function startPcChannels(screen: CanvasScreen): () => void {
  screen.switchTo(createPcChannel(pcChannelFor(pcRoute(useStore.getState()))), { transition: 'cut' })
  return useStore.subscribe((state, previous) => {
    if (state.route === previous.route && state.phase === previous.phase) return
    screen.switchTo(createPcChannel(pcChannelFor(pcRoute(state))))
  })
}

/** Notepad: one channel; the playing tape is circled. */
export function startNotepadChannel(screen: CanvasScreen, channel: NotepadChannel): () => void {
  screen.switchTo(channel, { transition: 'cut' })
  const sync = (route: Route) => {
    channel.setActive(route.page === 'work' ? route.tape : undefined)
    screen.invalidate()
  }
  sync(useStore.getState().route)
  return onRouteChange(sync)
}
