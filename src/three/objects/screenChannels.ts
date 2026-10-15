import type { CanvasScreen } from '../../screens/CanvasScreen'
import type { NotepadChannel } from '../../screens/channels/notepad/work'
import { createPcChannel } from '../../screens/channels/pc'
import { createBootChannel, createTvChannel } from '../../screens/channels/tv'
import { pcChannelFor, tvChannelFor } from '../../screens/routing'
import type { Route } from '../../state/router'
import { useStore } from '../../state/store'

/** How long the TV shows its "CH 03" boot screen before the route's channel. */
export const TV_BOOT_SECONDS = 1.3

function onRouteChange(listener: (route: Route) => void): () => void {
  return useStore.subscribe((state, previous) => {
    if (state.route !== previous.route) listener(state.route)
  })
}

/** TV: boot OSD, then the route's channel (static between channels). Returns the cleanup. */
export function startTvChannels(screen: CanvasScreen): () => void {
  let booted = false
  const show = (route: Route) => screen.switchTo(createTvChannel(tvChannelFor(route)))
  screen.switchTo(createBootChannel(), { transition: 'cut' })
  const bootMs = (useStore.getState().reducedMotion ? 0.4 : TV_BOOT_SECONDS) * 1000
  const timer = window.setTimeout(() => {
    booted = true
    show(useStore.getState().route)
  }, bootMs)
  const unsubscribe = onRouteChange((route) => {
    if (booted) show(route)
  })
  return () => {
    window.clearTimeout(timer)
    unsubscribe()
  }
}

/** PC: idle / about pager / contact menu per route. */
export function startPcChannels(screen: CanvasScreen): () => void {
  screen.switchTo(createPcChannel(pcChannelFor(useStore.getState().route)), { transition: 'cut' })
  return onRouteChange((route) => screen.switchTo(createPcChannel(pcChannelFor(route))))
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
