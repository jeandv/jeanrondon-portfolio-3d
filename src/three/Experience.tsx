import { Canvas } from '@react-three/fiber'
import { lazy, Suspense } from 'react'
import { AgXToneMapping } from 'three'
import { useStore } from '../state/store'
import { preloadRoom } from './assets'
import { BASE_FOV } from './camera/frames'
import { Scene } from './Scene'

const BACKGROUND = '#07080d'

// TODO(M4): move tone mapping (AgX, exposure 1.8) into the post-processing chain.
const GL_OPTIONS = {
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
  toneMapping: AgXToneMapping,
  toneMappingExposure: 1.8,
} as const

const CAMERA_OPTIONS = { fov: BASE_FOV, near: 0.02, far: 80 } as const

// r3f-perf only in dev, opt-in with `?perf` (stripped from production builds).
const Perf = import.meta.env.DEV ? lazy(() => import('r3f-perf').then((module) => ({ default: module.Perf }))) : null
const SHOW_PERF = import.meta.env.DEV && new URLSearchParams(window.location.search).has('perf')

preloadRoom()

/** Click on empty space: leave the TV zoom, then go back to the desk. */
function handlePointerMissed(): void {
  useStore.getState().back()
}

/** Lazy-loaded 3D chunk (three, R3F, drei) so the DOM shell paints first. */
export default function Experience() {
  const dpr = useStore((state) => state.device.dpr)
  return (
    <Canvas
      className="s-canvas"
      flat
      dpr={dpr}
      gl={GL_OPTIONS}
      camera={CAMERA_OPTIONS}
      onPointerMissed={handlePointerMissed}
      aria-hidden="true"
    >
      <color attach="background" args={[BACKGROUND]} />
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
      {SHOW_PERF && Perf && (
        <Suspense fallback={null}>
          <Perf position="bottom-left" />
        </Suspense>
      )}
    </Canvas>
  )
}
