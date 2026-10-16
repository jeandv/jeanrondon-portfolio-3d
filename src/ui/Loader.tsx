import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { enterRoom } from '../boot/controller'
import { percentOf } from '../boot/progress'
import {
  centeredQuad,
  matrix3dCss,
  OSD_HEIGHT,
  OSD_WIDTH,
  quadToMatrix3d,
  STILL_CALIBRATION,
  tvQuad,
  type Point,
} from '../boot/still'
import { CAPTURE } from '../capture/mode'
import { useStore, type LoaderMode } from '../state/store'
import { Gate } from './Gate'

/** Segments of the OSD progress bar. */
const SEGMENTS = 20

const STILL_ID = 's-still'

/** Announced (polite) when the gate opens, since focus is not moved there. */
const GATE_ANNOUNCEMENT = 'The room is ready. Press Enter to go in with sound, or choose Enter muted.'

/** The still lives in index.html (it paints before any JS); the loader only watches and removes it. */
function stillImage(): HTMLImageElement | null {
  return document.getElementById(STILL_ID)?.querySelector('img') ?? null
}

/** Keeps `html.still` in sync with the mode and drops to "free" if the still fails to load. */
function useStillImage(mode: LoaderMode): void {
  useEffect(() => {
    document.documentElement.classList.toggle('still', mode === 'still')
    if (mode !== 'still') return
    const toFree = () => useStore.getState().setLoaderMode('free')
    const image = stillImage()
    if (!image || (image.complete && image.naturalWidth === 0)) {
      toFree()
      return
    }
    image.addEventListener('error', toFree)
    return () => image.removeEventListener('error', toFree)
  }, [mode])
}

/** OSD corners in viewport px: the still's TV glass (cover-cropped), or a centred 4:3 screen. */
function osdQuad(mode: LoaderMode, width: number, height: number): Point[] {
  return mode === 'still' && STILL_CALIBRATION ? tvQuad(STILL_CALIBRATION, width, height) : centeredQuad(width, height)
}

/** Maps the 640×480 OSD box onto its quad with a matrix3d, again on every resize. */
function useOsdPlacement(
  rootRef: RefObject<HTMLDivElement | null>,
  osdRef: RefObject<HTMLDivElement | null>,
  mode: LoaderMode,
  mounted: boolean,
): void {
  useLayoutEffect(() => {
    const root = rootRef.current
    const osd = osdRef.current
    if (!mounted || !root || !osd) return
    const place = () => {
      const width = root.clientWidth || window.innerWidth
      const height = root.clientHeight || window.innerHeight
      const matrix =
        quadToMatrix3d(OSD_WIDTH, OSD_HEIGHT, osdQuad(mode, width, height)) ??
        quadToMatrix3d(OSD_WIDTH, OSD_HEIGHT, centeredQuad(width, height))
      if (!matrix) return
      osd.style.transform = matrix3dCss(matrix)
      osd.dataset.placed = 'true'
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(root)
    return () => observer.disconnect()
  }, [rootRef, osdRef, mode, mounted])
}

function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.closest('a, button, input, select, textarea') !== null || target.isContentEditable)
}

/** At the gate, Enter / Space anywhere (outside other controls) enters with sound. */
function useGateKeys(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if ((event.key !== 'Enter' && event.key !== ' ') || isControl(event.target)) return
      event.preventDefault()
      enterRoom({ sound: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])
}

function PlayGlyphs({ count }: { readonly count: number }) {
  return (
    <span className="s-osd-glyphs">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="s-osd-play" />
      ))}
    </span>
  )
}

function LoadingOsd({ percent }: { readonly percent: number }) {
  const lit = Math.floor((percent / 100) * SEGMENTS)
  return (
    <div
      className="s-osd-loading"
      role="progressbar"
      aria-label="Loading the room"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <p className="s-osd-top" aria-hidden="true">
        <span className="s-osd-mode">
          <PlayGlyphs count={2} />
          Loading
        </span>
        <span>CH 00</span>
      </p>
      <div className="s-osd-bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className="s-osd-seg" data-on={i < lit} />
        ))}
      </div>
      <p className="s-osd-percent" aria-hidden="true">
        {percent}%
      </p>
    </div>
  )
}

function onBackdropClick(): void {
  enterRoom({ sound: true })
}

export interface LoaderProps {
  /** False without WebGL (the HTML layer is the site): no overlay, and the still goes. */
  readonly enabled: boolean
}

/**
 * Boot overlay (plan §1 Loader, §5.1): a VCR OSD ("▶▶ LOADING", segmented
 * bar, %) laid onto the still's TV glass — or centred on a dark background in
 * "free" mode — that turns into the gate at 100%. While entering it bursts
 * into static and fades; once live it unmounts and the still leaves the DOM.
 */
export function Loader({ enabled }: LoaderProps) {
  const phase = useStore((state) => state.phase)
  const mode = useStore((state) => state.loaderMode)
  const percent = useStore((state) => percentOf(state.progress))
  const rootRef = useRef<HTMLDivElement>(null)
  const osdRef = useRef<HTMLDivElement>(null)
  const mounted = enabled && !CAPTURE && phase !== 'live' && phase !== 'fallback'

  useStillImage(mode)
  useOsdPlacement(rootRef, osdRef, mode, mounted)
  useGateKeys(phase === 'gate')

  // Live (or no WebGL): the still and its `html.still` flag are done for good.
  useEffect(() => {
    if (mounted) return
    document.getElementById(STILL_ID)?.remove()
    document.documentElement.classList.remove('still')
  }, [mounted])

  if (!mounted) return null
  return (
    <div
      ref={rootRef}
      className="s-loader"
      data-phase={phase}
      data-mode={mode}
      onClick={phase === 'gate' ? onBackdropClick : undefined}
    >
      <div ref={osdRef} className="s-osd">
        <div className="s-osd-screen">
          {phase === 'loading' ? <LoadingOsd percent={percent} /> : <Gate active={phase === 'gate'} />}
          <div className="s-osd-static" aria-hidden="true" />
        </div>
      </div>
      <p className="s-sr-only" role="status">
        {phase === 'gate' ? GATE_ANNOUNCEMENT : ''}
      </p>
    </div>
  )
}
