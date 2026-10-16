import { useStore, type AppState } from './store'

/**
 * Dev/test-only DOM mirrors of 3D state, for Playwright and the console:
 *   body[data-lamp]        on | off
 *   body[data-tape-state]  empty | loading | playing | ejecting  (the VCR)
 *   body[data-vcr-tape]    the tape id in (or entering / leaving) the VCR
 * Returns the cleanup; a no-op in production builds.
 */
export function startDevSignals(): () => void {
  if (!import.meta.env.DEV) return () => undefined
  const apply = ({ lampOn, vcr }: AppState) => {
    const data = document.body.dataset
    data.lamp = lampOn ? 'on' : 'off'
    data.tapeState = vcr.state
    data.vcrTape = vcr.tape ?? ''
  }
  apply(useStore.getState())
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.lampOn !== previous.lampOn || state.vcr !== previous.vcr) apply(state)
  })
  return () => {
    unsubscribe()
    const data = document.body.dataset
    delete data.lamp
    delete data.tapeState
    delete data.vcrTape
  }
}
