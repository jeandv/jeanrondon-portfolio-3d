import { describe, expect, it } from 'vitest'
import { assetBytes, assetKey, createByteTracker, FALLBACK_BYTES } from './bytes'

describe('asset manifest keys', () => {
  it('turns source and dev paths into keys relative to src/assets', () => {
    expect(assetKey('../../assets/bake/desk_albedo.webp')).toBe('bake/desk_albedo.webp')
    expect(assetKey('/src/assets/models/room.glb')).toBe('models/room.glb')
    expect(assetKey('src\\assets\\models\\room.glb')).toBe('models/room.glb')
    expect(assetKey('./other.bin')).toBe('other.bin')
  })

  it('reads sizes, with a fallback for unknown keys', () => {
    const sizes = { 'models/room.glb': 81_716, 'bake/empty.webp': 0 }
    expect(assetBytes('models/room.glb', sizes)).toBe(81_716)
    expect(assetBytes('bake/missing.webp', sizes)).toBe(FALLBACK_BYTES)
    expect(assetBytes('bake/empty.webp', sizes)).toBe(FALLBACK_BYTES)
  })
})

describe('createByteTracker', () => {
  const expected = new Map([
    ['/room.glb', 800],
    ['/desk_albedo.webp', 200],
  ])

  it('sums streamed bytes against the expected total', () => {
    const tracker = createByteTracker(expected)
    expect(tracker.fraction()).toBe(0)
    tracker.progress('/room.glb', 400)
    expect(tracker.fraction()).toBeCloseTo(0.4)
    tracker.end('/desk_albedo.webp')
    expect(tracker.fraction()).toBeCloseTo(0.6)
    tracker.end('/room.glb')
    expect(tracker.fraction()).toBe(1)
  })

  it('never goes back and never over-counts an item', () => {
    const tracker = createByteTracker(expected)
    tracker.progress('/room.glb', 600)
    tracker.progress('/room.glb', 300)
    expect(tracker.fraction()).toBeCloseTo(0.6)
    // Compressed transfer vs decoded size: a file reporting more than expected caps at its share.
    tracker.progress('/room.glb', 5000)
    expect(tracker.fraction()).toBeCloseTo(0.8)
    tracker.progress('/room.glb', Number.NaN)
    expect(tracker.fraction()).toBeCloseTo(0.8)
  })

  it('counts unexpected requests with the fallback size', () => {
    const tracker = createByteTracker(new Map([['/room.glb', FALLBACK_BYTES]]))
    tracker.end('/surprise.png')
    expect(tracker.fraction()).toBeCloseTo(0.5)
    tracker.end('/room.glb')
    expect(tracker.fraction()).toBe(1)
  })

  it('is 0 with nothing to load', () => {
    expect(createByteTracker(new Map()).fraction()).toBe(0)
  })
})
