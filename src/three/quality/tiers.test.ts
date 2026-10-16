import { describe, expect, it } from 'vitest'
import { fpsBounds, INITIAL_QUALITY, qualityInfo, qualityTiers, stepQuality, type QualityState } from './tiers'

describe('quality tiers', () => {
  it('steps the DPR down within the profile range, then drops MSAA', () => {
    expect(qualityTiers([1, 2], 4, 2)).toEqual([
      { dpr: 2, msaa: 4 },
      { dpr: 1.75, msaa: 4 },
      { dpr: 1.5, msaa: 4 },
      { dpr: 1.25, msaa: 4 },
      { dpr: 1, msaa: 4 },
      { dpr: 1, msaa: 0 },
    ])
    // Never above the screen's own DPR.
    expect(qualityTiers([1, 2], 4, 1)).toEqual([
      { dpr: 1, msaa: 4 },
      { dpr: 1, msaa: 0 },
    ])
    expect(qualityTiers([1, 2], 4, 1.25).map((tier) => tier.dpr)).toEqual([1.25, 1, 1])
    // Phones: [1, 1.5], MSAA already off.
    expect(qualityTiers([1, 1.5], 0, 3)).toEqual([
      { dpr: 1.5, msaa: 0 },
      { dpr: 1.25, msaa: 0 },
      { dpr: 1, msaa: 0 },
    ])
  })

  it('declines on sustained < 50 fps and climbs back above ~57 (60 Hz) or 90 (120 Hz)', () => {
    expect(fpsBounds(60)).toEqual([50, 57])
    expect(fpsBounds(144)).toEqual([50, 90])
  })
})

describe('quality stepper', () => {
  const tiers = 4

  it('moves one tier per event and stays within bounds', () => {
    let state: QualityState = INITIAL_QUALITY
    expect(stepQuality(state, 'up', tiers)).toBe(state)
    state = stepQuality(state, 'down', tiers)
    state = stepQuality(state, 'down', tiers)
    state = stepQuality(state, 'down', tiers)
    expect(state.index).toBe(3)
    expect(stepQuality(state, 'down', tiers)).toBe(state)
    expect(state.flips).toBe(0)
  })

  it('settles on the lower setting after 3 flip-flops', () => {
    let state: QualityState = INITIAL_QUALITY
    state = stepQuality(state, 'down', tiers) // 1
    state = stepQuality(state, 'up', tiers) // 0, flip 1
    state = stepQuality(state, 'down', tiers) // 1, flip 2
    expect(state).toMatchObject({ index: 1, flips: 2, settled: false })
    state = stepQuality(state, 'up', tiers) // would be 0: flip 3 → settle on 1
    expect(state).toMatchObject({ index: 1, flips: 3, settled: true })
    expect(stepQuality(state, 'up', tiers)).toBe(state)
    expect(stepQuality(state, 'down', tiers)).toBe(state)
  })

  it('settles on the new, lower tier when the last flip is a decline', () => {
    let state: QualityState = { index: 1, lastMove: 'up', flips: 2, settled: false }
    state = stepQuality(state, 'down', tiers)
    expect(state).toMatchObject({ index: 2, settled: true })
  })

  it('reports the tier for the store / __renderInfo', () => {
    const list = qualityTiers([1, 2], 4, 2)
    expect(qualityInfo({ index: 5, lastMove: 'down', flips: 0, settled: false }, list)).toEqual({
      tier: 5,
      tiers: 6,
      dpr: 1,
      msaa: 0,
      settled: false,
    })
  })
})
