import { PerformanceMonitor } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CAPTURE } from '../../capture/mode'
import { useStore } from '../../state/store'
import { fpsBounds, INITIAL_QUALITY, qualityInfo, qualityTiers, stepQuality, type QualityState } from './tiers'

/**
 * drei's PerformanceMonitor (10 × 250 ms fps windows; 75% of them below 50 fps
 * → decline, at/above ~57 → incline) steps the DPR through the profile's
 * tiers; the lowest tier also turns MSAA off (PostFX reads the store). Our
 * own stepper counts direction flips and settles on the lower setting (drei's
 * `flipflops` counts every event, including inclines that change nothing at
 * the top tier, so it is left unlimited). Only measured once live (boot
 * compiles stall frames) and never in ?capture.
 */
export function AdaptiveQuality() {
  const device = useStore((state) => state.device)
  const live = useStore((state) => state.phase === 'live')
  const setDpr = useThree((state) => state.setDpr)
  const tiers = useMemo(() => qualityTiers(device.dpr, device.msaa, window.devicePixelRatio), [device])
  const stateRef = useRef<QualityState>(INITIAL_QUALITY)

  useEffect(() => {
    if (CAPTURE) return
    stateRef.current = INITIAL_QUALITY
    useStore.getState().setQuality(qualityInfo(INITIAL_QUALITY, tiers))
    return () => useStore.getState().setQuality(null)
  }, [tiers])

  const move = useCallback(
    (direction: 'up' | 'down') => {
      const next = stepQuality(stateRef.current, direction, tiers.length)
      if (next === stateRef.current) return
      const changed = next.index !== stateRef.current.index
      stateRef.current = next
      const tier = tiers[next.index]
      if (changed && tier) setDpr(tier.dpr)
      useStore.getState().setQuality(qualityInfo(next, tiers))
    },
    [tiers, setDpr],
  )
  const onDecline = useCallback(() => move('down'), [move])
  const onIncline = useCallback(() => move('up'), [move])

  if (CAPTURE || !live) return null
  return <PerformanceMonitor bounds={fpsBounds} flipflops={Number.POSITIVE_INFINITY} onDecline={onDecline} onIncline={onIncline} />
}
