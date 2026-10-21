import { useStore, type AppState } from './store'

/**
 * Dev/test-only DOM mirrors of 3D state, for Playwright and the console:
 *   body[data-lamp]         on | off
 *   body[data-tape-state]   empty | loading | playing | ejecting  (the VCR)
 *   body[data-vcr-tape]     the tape id in (or entering / leaving) the VCR
 *   body[data-bbs]          off | dialing | menu  (the PC on #online)
 *   body[data-sips]         sips taken from the current cup (0–5)
 *   body[data-cv]           open | closed  (the CV index card from the rolodex)
 *   body[data-clock]        running | stopped  (the wall clock's battery)
 *   body[data-camera-mode]  route | tv | cd  (a close-up on top of the route)
 *   body[data-flying]       true | false  (a camera flight is under way)
 *   body[data-music]        stopped | loading | playing | paused  (the disc in the CD player)
 *   body[data-cd-lid]       open | closed
 *   body[data-cd-track]     1-based track number of the disc in the CD player
 *   body[data-disc]         tapes | joji  (the generated lo-fi / Joji on YouTube)
 *   body[data-volume]       the shared music volume (0–100)
 *   body[data-led]          violet | teal | amber | off  (the LED strip behind the desk)
 *   body[data-calc]         what the calculator's LCD reads
 *   body[data-calc-up]      up | down
 *   body[data-last-cap]     KeyboardEvent.code of the last PC key cap pressed
 * Returns the cleanup; a no-op in production builds.
 */
const KEYS = [
  'lamp',
  'tapeState',
  'vcrTape',
  'bbs',
  'sips',
  'cv',
  'clock',
  'cameraMode',
  'flying',
  'music',
  'cdLid',
  'cdTrack',
  'calc',
  'calcUp',
  'lastCap',
  'disc',
  'volume',
  'led',
] as const

export function startDevSignals(): () => void {
  if (!import.meta.env.DEV) return () => undefined
  const apply = ({ lampOn, vcr, bbs, cup, cvOpen, clock, zoom, flying, cd, calc, calcUp, disc, yt, volume, led }: AppState) => {
    const data = document.body.dataset
    data.lamp = lampOn ? 'on' : 'off'
    data.tapeState = vcr.state
    data.vcrTape = vcr.tape ?? ''
    data.bbs = bbs
    data.sips = String(cup.sips)
    data.cv = cvOpen ? 'open' : 'closed'
    data.clock = clock.running ? 'running' : 'stopped'
    data.cameraMode = zoom ?? 'route'
    data.flying = String(flying)
    data.music = disc === 'joji' ? yt.status : cd.status
    data.cdLid = cd.lid
    data.cdTrack = String((disc === 'joji' ? yt.track : cd.track) + 1)
    data.calc = calc.display
    data.calcUp = calcUp ? 'up' : 'down'
    data.disc = disc
    data.volume = String(volume)
    data.led = led
  }
  apply(useStore.getState())
  const unsubscribe = useStore.subscribe((state, previous) => {
    const changed =
      state.lampOn !== previous.lampOn ||
      state.vcr !== previous.vcr ||
      state.bbs !== previous.bbs ||
      state.cup !== previous.cup ||
      state.cvOpen !== previous.cvOpen ||
      state.clock !== previous.clock ||
      state.zoom !== previous.zoom ||
      state.flying !== previous.flying ||
      state.cd !== previous.cd ||
      state.calc !== previous.calc ||
      state.calcUp !== previous.calcUp ||
      state.disc !== previous.disc ||
      state.yt !== previous.yt ||
      state.volume !== previous.volume ||
      state.led !== previous.led
    if (changed) apply(state)
  })
  return () => {
    unsubscribe()
    const data = document.body.dataset
    for (const key of KEYS) delete data[key]
  }
}

/** Dev: mirrors the last PC key cap pressed (events, not store state). */
export function signalLastCap(code: string): void {
  if (import.meta.env.DEV) document.body.dataset.lastCap = code
}
