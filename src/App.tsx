import { lazy, Suspense, useEffect, useState } from 'react'
import { TAPE_IDS } from './content/work'
import { useDeviceProfile } from './hooks/useDeviceProfile'
import { useKeyboard } from './hooks/useKeyboard'
import { useReducedMotion } from './hooks/useReducedMotion'
import { startRouter } from './state/router'
import { useStore } from './state/store'
import { Header } from './ui/Header'
import { HintBar } from './ui/HintBar'
import { LiveRegion } from './ui/LiveRegion'
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

/** Keeps the store in sync with the hash, reduced-motion and device media queries. */
function useEnvironmentSync(): void {
  const reducedMotion = useReducedMotion()
  const device = useDeviceProfile()

  useEffect(() => startRouter((route) => useStore.getState().setRoute(route), TAPE_IDS), [])
  useEffect(() => useStore.getState().setReducedMotion(reducedMotion), [reducedMotion])
  useEffect(() => useStore.getState().setDevice(device), [device])
}

export default function App() {
  useEnvironmentSync()
  useKeyboard()
  const [webgl] = useState(supportsWebGL2)

  useEffect(() => {
    // TODO(M6): readable fallback (SEO content layer) when WebGL2 is missing.
    if (!webgl) useStore.getState().setPhase('fallback')
  }, [webgl])

  return (
    <>
      <Header />
      <div className="s-stage">
        {webgl && (
          <Suspense fallback={null}>
            <Experience />
          </Suspense>
        )}
      </div>
      <HintBar />
      <div className="s-pills">
        <SoundToggle />
      </div>
      <Tooltip />
      <LiveRegion />
    </>
  )
}
