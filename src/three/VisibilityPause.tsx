import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { MAX_DT } from './objects/motion'

type RunningFrameloop = 'always' | 'demand'

/**
 * Hidden tab (plan §5.9): frameloop 'never' until the tab is visible again.
 * R3F's setFrameloop restarts the clock at 0, so the elapsed time is put back
 * (screens and shaders keep their timeline), and the first delta after the
 * pause is clamped to MAX_DT (1/20 s).
 */
export function VisibilityPause() {
  const get = useThree((state) => state.get)

  useEffect(() => {
    let paused: { elapsed: number; frameloop: RunningFrameloop } | null = null

    const onChange = () => {
      const state = get()
      if (document.visibilityState === 'hidden') {
        if (paused || state.frameloop === 'never') return
        paused = { elapsed: state.clock.elapsedTime, frameloop: state.frameloop }
        state.setFrameloop('never')
        return
      }
      if (!paused) return
      const { elapsed, frameloop } = paused
      paused = null
      const clock = state.clock
      // Queued before R3F's own frame callback, so it runs first on the next frame.
      requestAnimationFrame(() => {
        clock.oldTime = Math.max(clock.oldTime, performance.now() - MAX_DT * 1000)
      })
      state.setFrameloop(frameloop)
      clock.elapsedTime = elapsed
    }

    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [get])

  return null
}
