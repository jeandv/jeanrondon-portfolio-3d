import { describe, expect, it } from 'vitest'
import {
  coffeeLeft,
  COOL_MS,
  fullCup,
  heatOf,
  isEmpty,
  isSipping,
  maybeRefill,
  MIN_HEAT,
  REFILL_MS,
  refillDue,
  SIP_SECONDS,
  SIP_TIMING,
  sipPhase,
  SIPS_PER_CUP,
  steamAmount,
  takeSip,
  type CupState,
} from './cup'

const SIP_GAP = SIP_SECONDS * 1000 + 1

/** Takes `count` sips, each after the previous one finished. */
function sipped(count: number, start = 0): CupState {
  let cup = fullCup(start)
  for (let i = 0; i < count; i++) cup = takeSip(cup, start + i * SIP_GAP)
  return cup
}

describe('coffee cup', () => {
  it('five sips empty it, level by level', () => {
    expect(SIPS_PER_CUP).toBe(5)
    const levels = Array.from({ length: SIPS_PER_CUP + 1 }, (_, i) => coffeeLeft(sipped(i).sips))
    ;[1, 0.8, 0.6, 0.4, 0.2, 0].forEach((level, i) => expect(levels[i]).toBeCloseTo(level))
    expect(isEmpty(sipped(4))).toBe(false)
    expect(isEmpty(sipped(5))).toBe(true)
    expect(sipped(5).emptiedAt).toBe(4 * SIP_GAP)
  })

  it('ignores a click mid-sip and any click on an empty cup', () => {
    const first = takeSip(fullCup(0), 1000)
    expect(isSipping(first, 1500)).toBe(true)
    expect(takeSip(first, 1500)).toBe(first)
    expect(takeSip(first, 1000 + SIP_GAP).sips).toBe(2)
    const empty = sipped(5)
    expect(takeSip(empty, 10 * SIP_GAP)).toBe(empty)
  })

  it('refills after a while, not before', () => {
    const empty = sipped(5)
    const emptiedAt = empty.emptiedAt ?? 0
    expect(refillDue(empty, emptiedAt + REFILL_MS - 1)).toBe(false)
    expect(maybeRefill(empty, emptiedAt + REFILL_MS - 1)).toBe(empty)
    expect(refillDue(empty, emptiedAt + REFILL_MS)).toBe(true)
    const fresh = maybeRefill(empty, emptiedAt + REFILL_MS)
    expect(fresh).toEqual(fullCup(emptiedAt + REFILL_MS))
    // A cup that is not empty never refills.
    expect(refillDue(sipped(3), 10 * REFILL_MS)).toBe(false)
  })

  it('steams less as it cools and empties, not at all when empty', () => {
    const cup = fullCup(0)
    expect(heatOf(cup, 0)).toBe(1)
    expect(heatOf(cup, COOL_MS)).toBeCloseTo(MIN_HEAT + (1 - MIN_HEAT) / Math.E)
    expect(heatOf(cup, 100 * COOL_MS)).toBeCloseTo(MIN_HEAT)
    expect(steamAmount(cup, 0)).toBe(1)
    expect(steamAmount(cup, COOL_MS)).toBeLessThan(steamAmount(cup, 0))
    const half = sipped(3)
    expect(steamAmount(half, 0)).toBeLessThan(steamAmount(sipped(1), 0))
    expect(steamAmount(sipped(5), 0)).toBe(0)
  })

  it('times the sip: lift, hold at the lips, put back', () => {
    expect(sipPhase(-1)).toBe('idle')
    expect(sipPhase(0)).toBe('lift')
    expect(sipPhase(SIP_TIMING.lift)).toBe('hold')
    expect(SIP_TIMING.hold).toBeCloseTo(0.42)
    expect(sipPhase(SIP_TIMING.lift + SIP_TIMING.hold)).toBe('back')
    expect(sipPhase(SIP_SECONDS)).toBe('idle')
    expect(sipPhase(Number.POSITIVE_INFINITY)).toBe('idle')
  })
})
