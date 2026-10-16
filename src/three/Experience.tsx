import { Canvas } from '@react-three/fiber'
import { lazy, Suspense } from 'react'
import { CAPTURE } from '../capture/mode'
import { useStore } from '../state/store'
import { bootAssets, preloadRoom } from './assets'
import { BASE_FOV } from './camera/frames'
import { CaptureBridge } from './CaptureBridge'
import { RenderInfoBridge } from './dev/RenderInfoBridge'
import { trackLoading } from './loading'
import { PostFX } from './post/PostFX'
import { Scene } from './Scene'
import { VisibilityPause } from './VisibilityPause'

const BACKGROUND = '#07080d'

/**
 * Tone mapping and exposure live in the post chain (PostFX: Film exposure 1.8
 * → AgX). `flat` keeps the renderer on NoToneMapping (the composer enforces it
 * too) and exposure must stay 1: ToneMappingEffect's AgX reads
 * renderer.toneMappingExposure, so anything else would apply exposure twice.
 * Output stays sRGB (R3F default); the scene renders linear into HalfFloat.
 */
const GL_OPTIONS = {
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
  toneMappingExposure: 1,
} as const

const CAMERA_OPTIONS = { fov: BASE_FOV, near: 0.02, far: 80 } as const

// r3f-perf only in dev, opt-in with `?perf` (stripped from production builds).
const Perf = import.meta.env.DEV ? lazy(() => import('r3f-perf').then((module) => ({ default: module.Perf }))) : null
const SHOW_PERF = import.meta.env.DEV && new URLSearchParams(window.location.search).has('perf')

// Byte progress for the loader (before the first request), then start the GLB right away.
trackLoading(bootAssets(useStore.getState().device.texSuffix))
preloadRoom()

/** Click on empty space: leave the TV zoom, then go back to the desk (only once live). */
function handlePointerMissed(): void {
  const state = useStore.getState()
  if (state.phase === 'live') state.back()
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
      <PostFX />
      <VisibilityPause />
      {CAPTURE && <CaptureBridge />}
      {import.meta.env.DEV && <RenderInfoBridge />}
      {SHOW_PERF && Perf && (
        <Suspense fallback={null}>
          <Perf position="bottom-left" />
        </Suspense>
      )}
    </Canvas>
  )
}
