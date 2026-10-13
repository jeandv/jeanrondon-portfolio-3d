import { describe, expect, it } from 'vitest'
import { parseHash } from '../state/router'
import { TAPE_IDS, TAPES, tapeBySlot } from './work'

describe('work content', () => {
  it('has at most 8 tapes with unique ids', () => {
    expect(TAPES.length).toBeLessThanOrEqual(8)
    expect(TAPE_IDS.size).toBe(TAPES.length)
  })

  it('uses unique shelf slots between 1 and 8', () => {
    const slots = TAPES.map((tape) => tape.slot)
    expect(new Set(slots).size).toBe(slots.length)
    for (const slot of slots) {
      expect(Number.isInteger(slot) && slot >= 1 && slot <= 8).toBe(true)
      expect(tapeBySlot(slot)?.slot).toBe(slot)
    }
  })

  it('ids survive the #work/<id> route', () => {
    for (const tape of TAPES) {
      expect(parseHash(`#work/${tape.id}`, TAPE_IDS)).toEqual({ page: 'work', tape: tape.id })
    }
  })

  it('fills the required fields', () => {
    for (const tape of TAPES) {
      expect(tape.title.trim()).not.toBe('')
      expect(tape.years.trim()).not.toBe('')
      expect(tape.bullets.length).toBeGreaterThan(0)
    }
  })
})
