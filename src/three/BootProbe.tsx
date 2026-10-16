import { Preload } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GATE_FRAMES } from '../boot/progress'
import { bootSignals } from '../boot/signals'

/** Mounted after <Preload all/>: its layout effect runs once the scene is compiled; then it counts frames. */
function CompiledProbe() {
  const calls = useRef(0)
  useLayoutEffect(() => {
    bootSignals.getState().markCompiled()
  }, [])
  useFrame(() => {
    if (calls.current > GATE_FRAMES) return
    calls.current += 1
    // Callback n runs after n − 1 frames have been rendered since the compile.
    bootSignals.getState().setFrames(calls.current - 1)
  })
  return null
}

/**
 * Reports the 3D side of the gate conditions (plan §5.1). It mounts last in
 * the screens' Suspense, so the GLB, textures and fonts are in. One frame
 * later (every sibling's effects, e.g. screen material swaps, have run)
 * drei's <Preload all/> compiles the whole scene and uploads its textures;
 * then the first rendered frames are counted.
 */
export function BootProbe() {
  const [warm, setWarm] = useState(false)
  useEffect(() => {
    bootSignals.getState().markAssets()
    const frame = requestAnimationFrame(() => setWarm(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  if (!warm) return null
  return (
    <>
      <Preload all />
      <CompiledProbe />
    </>
  )
}
