import { sfx } from '../../audio/sfx'
import { isBootPhase } from '../../boot/machine'
import { CAPTURE } from '../../capture/mode'
import type { CanvasScreen } from '../../screens/CanvasScreen'
import type { NotepadChannel } from '../../screens/channels/notepad/work'
import { createPcChannel } from '../../screens/channels/pc'
import { createBootChannel, createTvChannel } from '../../screens/channels/tv'
import { pcChannelFor, tvChannelFor } from '../../screens/routing'
import { HOME, type Route } from '../../state/router'
import { useStore, type Phase } from '../../state/store'

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

/**
 * TV: the boot OSD while loading / at the gate, the route's channel once the
 * visitor enters (static between channels). ?capture cuts straight to it.
 * Returns the cleanup.
 */
export function startTvChannels(screen: CanvasScreen): () => void {
  let booted = false
  let timer = 0
  const show = (route: Route) => screen.switchTo(createTvChannel(tvChannelFor(route)))

  const boot = () => {
    if (booted || timer) return
    const hold = useStore.getState().reducedMotion ? 0 : TV_BOOT_HOLD_SECONDS
    timer = window.setTimeout(() => {
      booted = true
      show(useStore.getState().route)
    }, hold * 1000)
  }

  if (CAPTURE) {
    booted = true
    screen.switchTo(createTvChannel(tvChannelFor(useStore.getState().route)), { transition: 'cut' })
  } else {
    screen.switchTo(createBootChannel(), { transition: 'cut' })
    if (!isBootPhase(useStore.getState().phase)) boot()
  }

  const unsubscribe = useStore.subscribe((state, previous) => {
    if (!booted && !isBootPhase(state.phase)) boot()
    if (booted && state.route !== previous.route) {
      sfx('static')
      show(state.route)
    }
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
