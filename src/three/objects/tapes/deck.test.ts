import { describe, expect, it } from 'vitest'
import { advance, AT_SLOT, DECK_TIMING, deckTarget, GATE_S, OFF_SHELF, SEGMENTS, TapeDeck, type DeckEvent } from './deck'

const FRAME = 1 / 60
const IDS = ['a', 'b', 'c', 'd'] as const

/** Runs the deck for `seconds`, checking the invariants every frame; returns every event. */
function run(deck: TapeDeck, seconds: number, dt = FRAME): DeckEvent[] {
  const events: DeckEvent[] = []
  for (let t = 0; t < seconds; t += dt) {
    events.push(...deck.update(dt))
    const out = IDS.filter((id) => deck.progress(id) > OFF_SHELF)
    // Never two tapes above the shelf (in the air or in the VCR) at once.
    expect(out.length).toBeLessThanOrEqual(1)
    for (const id of IDS) {
      expect(deck.progress(id)).toBeGreaterThanOrEqual(0)
      expect(deck.progress(id)).toBeLessThanOrEqual(SEGMENTS)
    }
  }
  return events
}

const insertSeconds = DECK_TIMING.insert.reduce((sum, s) => sum + s, 0)
const ejectSeconds = DECK_TIMING.eject.reduce((sum, s) => sum + s, 0)

describe('advance', () => {
  it('crosses segments at their own speeds and stops at the limit', () => {
    expect(advance(0, DECK_TIMING.insert[0], 1, SEGMENTS, DECK_TIMING.insert)).toBeCloseTo(1)
    expect(advance(0, insertSeconds + 1, 1, SEGMENTS, DECK_TIMING.insert)).toBe(SEGMENTS)
    expect(advance(SEGMENTS, ejectSeconds + 1, -1, 0, DECK_TIMING.eject)).toBe(0)
    expect(advance(0, 10, 1, GATE_S, DECK_TIMING.insert)).toBe(GATE_S)
    expect(advance(1.5, 0, 1, SEGMENTS, DECK_TIMING.insert)).toBe(1.5)
  })
})

describe('TapeDeck', () => {
  it('inserts a tape: pull → arc → push, one flap kick, one thump, then playing', () => {
    const deck = new TapeDeck(IDS)
    deck.setTarget('a')
    expect(deck.status()).toEqual({ tape: null, state: 'empty' })
    run(deck, 0.1)
    expect(deck.motion('a')).toBe('inserting')
    expect(deck.status()).toEqual({ tape: 'a', state: 'loading' })
    const events = run(deck, insertSeconds + 0.2)
    expect(deck.progress('a')).toBe(SEGMENTS)
    expect(deck.motion('a')).toBe('playing')
    expect(deck.status()).toEqual({ tape: 'a', state: 'playing' })
    expect(events.filter((e) => e.type === 'flap')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'inserted')).toEqual([{ type: 'inserted', tape: 'a' }])
    expect(deck.settled).toBe(true)
  })

  it('switches: the playing tape ejects first, the new one waits slid out, then goes in', () => {
    const deck = new TapeDeck(IDS)
    deck.setTarget('a')
    run(deck, insertSeconds + 0.2)
    deck.setTarget('b')
    const first = run(deck, FRAME)
    expect(first).toContainEqual({ type: 'eject', tape: 'a' })
    expect(deck.status()).toEqual({ tape: 'a', state: 'ejecting' })
    run(deck, 0.3)
    // b slid out a little and waits while a is still above the shelf.
    expect(deck.progress('b')).toBeGreaterThan(0)
    expect(deck.progress('b')).toBeLessThanOrEqual(GATE_S)
    const events = run(deck, ejectSeconds + insertSeconds + 0.5)
    expect(deck.progress('a')).toBe(0)
    expect(deck.progress('b')).toBe(SEGMENTS)
    expect(events).toContainEqual({ type: 'parked', tape: 'a' })
    expect(events).toContainEqual({ type: 'inserted', tape: 'b' })
  })

  it('rapid switching always converges on the last target', () => {
    const deck = new TapeDeck(IDS)
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 60; i++) {
      deck.setTarget(IDS[Math.floor(random() * IDS.length)] ?? null)
      run(deck, random() * 0.4)
    }
    deck.setTarget('c')
    run(deck, (ejectSeconds + insertSeconds) * 2)
    expect(IDS.map((id) => deck.progress(id))).toEqual([0, 0, SEGMENTS, 0])
    expect(deck.settled).toBe(true)
    expect(deck.status()).toEqual({ tape: 'c', state: 'playing' })
  })

  it('a reversed tape mid-air flies straight back without an eject click', () => {
    const deck = new TapeDeck(IDS)
    deck.setTarget('a')
    run(deck, DECK_TIMING.insert[0] + DECK_TIMING.insert[1] / 2)
    expect(deck.progress('a')).toBeGreaterThan(OFF_SHELF)
    expect(deck.progress('a')).toBeLessThan(AT_SLOT)
    deck.setTarget('b')
    const events = run(deck, ejectSeconds + insertSeconds + 0.5)
    expect(events.some((e) => e.type === 'eject')).toBe(false)
    expect(deck.progress('a')).toBe(0)
    expect(deck.progress('b')).toBe(SEGMENTS)
  })

  it('#work without a tape ejects it back to the shelf', () => {
    const deck = new TapeDeck(IDS)
    deck.setTarget('d')
    run(deck, insertSeconds + 0.2)
    deck.setTarget(null)
    const events = run(deck, ejectSeconds + 0.2)
    expect(deck.progress('d')).toBe(0)
    expect(events).toContainEqual({ type: 'eject', tape: 'd' })
    expect(events).toContainEqual({ type: 'parked', tape: 'd' })
    expect(deck.status()).toEqual({ tape: null, state: 'empty' })
  })

  it('reduced motion / capture snap to the final state in one step', () => {
    const deck = new TapeDeck(IDS)
    deck.setTarget('a')
    expect(deck.update(FRAME, true)).toEqual([{ type: 'inserted', tape: 'a' }])
    expect(deck.progress('a')).toBe(SEGMENTS)
    deck.setTarget('b')
    const events = deck.update(FRAME, true)
    expect(events).toContainEqual({ type: 'eject', tape: 'a' })
    expect(events).toContainEqual({ type: 'inserted', tape: 'b' })
    expect(events.some((e) => e.type === 'flap')).toBe(false)
    expect([deck.progress('a'), deck.progress('b')]).toEqual([0, SEGMENTS])
  })

  it('a tape without a shelf node plays once the VCR is free', () => {
    const deck = new TapeDeck(['a'])
    deck.setTarget('ghost')
    expect(deck.status()).toEqual({ tape: 'ghost', state: 'playing' })
  })
})

describe('deckTarget', () => {
  it('follows #work routes only once live; other pages keep the tape in', () => {
    expect(deckTarget(null, 'gate', { page: 'work', tape: 'a' })).toBeNull()
    expect(deckTarget(null, 'entering', { page: 'work', tape: 'a' })).toBeNull()
    // Deep link: the animation starts once live.
    expect(deckTarget(null, 'live', { page: 'work', tape: 'a' })).toBe('a')
    expect(deckTarget('a', 'live', { page: 'home' })).toBe('a')
    expect(deckTarget('a', 'live', { page: 'about' })).toBe('a')
    expect(deckTarget('a', 'live', { page: 'work' })).toBeNull()
  })
})
