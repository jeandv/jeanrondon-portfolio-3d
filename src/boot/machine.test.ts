import { describe, expect, it } from 'vitest'
import type { Phase } from '../state/store'
import { isBootPhase, isInteractivePhase, transition, type BootEvent } from './machine'

const PHASES: readonly Phase[] = ['loading', 'gate', 'entering', 'live', 'fallback']
const EVENTS: readonly BootEvent[] = ['ready', 'enter', 'entered', 'skip', 'fail']

describe('boot state machine', () => {
  it('walks loading → gate → entering → live', () => {
    let phase: Phase = 'loading'
    phase = transition(phase, 'ready')
    expect(phase).toBe('gate')
    phase = transition(phase, 'enter')
    expect(phase).toBe('entering')
    phase = transition(phase, 'entered')
    expect(phase).toBe('live')
  })

  it('ignores events that do not apply to the current phase', () => {
    expect(transition('loading', 'enter')).toBe('loading')
    expect(transition('loading', 'entered')).toBe('loading')
    expect(transition('gate', 'ready')).toBe('gate')
    expect(transition('gate', 'entered')).toBe('gate')
    expect(transition('entering', 'enter')).toBe('entering')
    expect(transition('live', 'ready')).toBe('live')
    expect(transition('live', 'enter')).toBe('live')
  })

  it('capture skips the gate straight to live', () => {
    expect(transition('loading', 'skip')).toBe('live')
    expect(transition('gate', 'skip')).toBe('live')
    expect(transition('entering', 'skip')).toBe('entering')
  })

  it('falls back from any phase, and fallback is final', () => {
    for (const phase of PHASES) expect(transition(phase, 'fail')).toBe('fallback')
    for (const event of EVENTS) expect(transition('fallback', event)).toBe('fallback')
  })

  it('keeps the camera home and the room inert until the gate is passed', () => {
    expect(PHASES.filter(isBootPhase)).toEqual(['loading', 'gate'])
    expect(PHASES.filter(isInteractivePhase)).toEqual(['live'])
  })
})
