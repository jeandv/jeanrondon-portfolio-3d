import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { startAudio } from './audio/wiring'
import { startBoot } from './boot/controller'
import { CAPTURE } from './capture/mode'
import { TAPE_IDS } from './content/work'
import { useDeviceProfile } from './hooks/useDeviceProfile'
import { useKeyboard } from './hooks/useKeyboard'
import { useReducedMotion } from './hooks/useReducedMotion'
import { useSectionFocus } from './seo/useSectionFocus'
import { startDevSignals } from './state/devSignals'
import { enterFallback, watchContextLoss } from './state/fallback'
import { startRouter } from './state/router'
import { useStore, type Phase } from './state/store'
import { CreditsToggle } from './ui/CreditsToggle'
import { Header } from './ui/Header'
import { HintBar } from './ui/HintBar'
import { LiveRegion } from './ui/LiveRegion'
import { Loader } from './ui/Loader'
import { MiniPlayer } from './ui/MiniPlayer'
import { SceneBoundary } from './ui/SceneBoundary'
import { SoundToggle } from './ui/SoundToggle'
import { Tooltip } from './ui/Tooltip'

const Experience = lazy(() => import('./three/Experience'))

function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return gl !== null
  } catch {
    return false
  }
}

/**
 * The inline script in index.html already tested WebGL2 (and `?lite`) and
 * flagged `html.js` / `html.webgl`, which the CSS uses to hide the SEO layer.
 * Reuse that verdict; detect here only if the script did not run.
 */
function detectWebGL(): boolean {
  const root = document.documentElement
  if (root.classList.contains('js')) return root.classList.contains('webgl')
  const webgl = supportsWebGL2()
  root.classList.add('js')
  root.classList.toggle('webgl', webgl)
  return webgl
}

/** Keeps the store in sync with the hash, reduced-motion and device media queries. */
function useEnvironmentSync(): void {
  const reducedMotion = useReducedMotion()
  const device = useDeviceProfile()

  useEffect(() => startRouter((route) => useStore.getState().setRoute(route), TAPE_IDS), [])
  useEffect(() => useStore.getState().setReducedMotion(reducedMotion), [reducedMotion])
  useEffect(() => useStore.getState().setDevice(device), [device])
}

function applyPhase(phase: Phase): void {
  document.documentElement.dataset.phase = phase
}

/**
 * Boot (plan §5.1): mirrors the phase on `<html data-phase>` (CSS fades),
 * wires the audio engine, and runs the progress loop while the 3D layer
 * loads. `?capture` (dev) goes straight to live without the gate or chrome.
 */
function useBoot(webgl: boolean): void {
  useEffect(() => {
    document.documentElement.classList.toggle('capture', CAPTURE)
    applyPhase(useStore.getState().phase)
    return useStore.subscribe((state, previous) => {
      if (state.phase !== previous.phase) applyPhase(state.phase)
    })
  }, [])
  useEffect(() => startAudio(), [])
  useEffect(() => startDevSignals(), [])
  useEffect(() => (webgl ? startBoot({ capture: CAPTURE }) : undefined), [webgl])
}

function onSceneError(error: unknown, componentStack?: string | null): void {
  enterFallback('the 3D layer crashed; showing the HTML site', error)
  if (import.meta.env.DEV && componentStack) console.error(componentStack)
}

function onContextGone(): void {
  enterFallback('the WebGL context was lost and not restored; showing the HTML site', undefined, 'warn')
}

export default function App() {
  useEnvironmentSync()
  useKeyboard()
  const [webglAvailable] = useState(detectWebGL)
  // A crash or a lost context also lands in 'fallback' (header/nav stay mounted).
  const fallback = useStore((state) => state.phase === 'fallback')
  const webgl = webglAvailable && !fallback
  const stageRef = useRef<HTMLDivElement>(null)
  useSectionFocus(webgl)
  useBoot(webgl)

  useEffect(() => {
    // Without WebGL2 the SEO layer (#seo) is the readable site (styles/seo.css).
    if (!webglAvailable) enterFallback('WebGL2 unavailable (or ?lite); showing the HTML site')
  }, [webglAvailable])

  useEffect(() => {
    const stage = stageRef.current
    if (!webgl || !stage) return
    return watchContextLoss(stage, onContextGone)
  }, [webgl])

  return (
    <>
      <Header />
      <div className="s-stage" ref={stageRef}>
        {webgl && (
          <SceneBoundary onError={onSceneError}>
            <Suspense fallback={null}>
              <Experience />
            </Suspense>
          </SceneBoundary>
        )}
      </div>
      <Loader enabled={webgl} />
      <HintBar />
      <MiniPlayer />
      <div className="s-pills">
        <CreditsToggle />
        <SoundToggle />
      </div>
      <Tooltip />
      <LiveRegion />
    </>
  )
}
