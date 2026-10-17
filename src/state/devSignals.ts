import { useStore, type AppState } from './store'

/**
 * Dev/test-only DOM mirrors of 3D state, for Playwright and the console:
 *   body[data-lamp]        on | off
 *   body[data-tape-state]  empty | loading | playing | ejecting  (the VCR)
 *   body[data-vcr-tape]    the tape id in (or entering / leaving) the VCR
 *   body[data-bbs]         off | dialing | menu  (the PC on #online)
 *   body[data-sips]        sips taken from the current cup (0–5)
 *   body[data-credits]     open | closed
 *   body[data-clock]       running | stopped  (the wall clock's battery)
 * Returns the cleanup; a no-op in production builds.
 */
export function startDevSignals(): () => void {
  if (!import.meta.env.DEV) return () => undefined
  const apply = ({ lampOn, vcr, bbs, cup, creditsOpen, clock }: AppState) => {
    const data = document.body.dataset
    data.lamp = lampOn ? 'on' : 'off'
    data.tapeState = vcr.state
    data.vcrTape = vcr.tape ?? ''
    data.bbs = bbs
    data.sips = String(cup.sips)
    data.credits = creditsOpen ? 'open' : 'closed'
    data.clock = clock.running ? 'running' : 'stopped'
  }
  apply(useStore.getState())
  const unsubscribe = useStore.subscribe((state, previous) => {
    const changed =
      state.lampOn !== previous.lampOn ||
      state.vcr !== previous.vcr ||
      state.bbs !== previous.bbs ||
      state.cup !== previous.cup ||
      state.creditsOpen !== previous.creditsOpen ||
      state.clock !== previous.clock
    if (changed) apply(state)
  })
  return () => {
    unsubscribe()
    const data = document.body.dataset
    delete data.lamp
    delete data.tapeState
    delete data.vcrTape
    delete data.bbs
    delete data.sips
    delete data.credits
    delete data.clock
  }
}
