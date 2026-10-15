import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enterFallback, watchContextLoss } from '../state/fallback'
import { useStore } from '../state/store'
import { SceneBoundary } from './SceneBoundary'

describe('SceneBoundary', () => {
  it('catches a render error, reports it once and renders nothing', () => {
    const onError = vi.fn()
    const boundary = new SceneBoundary({ onError, children: 'scene' })
    expect(boundary.render()).toBe('scene')

    const error = new ReferenceError('city is not defined')
    expect(SceneBoundary.getDerivedStateFromError()).toEqual({ failed: true })
    boundary.componentDidCatch(error, { componentStack: '\n    at WindowView' })
    expect(onError).toHaveBeenCalledWith(error, '\n    at WindowView')

    boundary.state = SceneBoundary.getDerivedStateFromError()
    expect(boundary.render()).toBeNull()
  })
})

describe('enterFallback', () => {
  it('moves the app to the fallback phase', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useStore.getState().setPhase('live')
    enterFallback('test crash', new Error('boom'))
    expect(useStore.getState().phase).toBe('fallback')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('watchContextLoss', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const lose = (target: EventTarget) => {
    const event = new Event('webglcontextlost', { cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  it('asks for a restore and gives up after the timeout', () => {
    const target = new EventTarget()
    const onGiveUp = vi.fn()
    const stop = watchContextLoss(target, onGiveUp, 2000)
    expect(lose(target).defaultPrevented).toBe(true)
    vi.advanceTimersByTime(1999)
    expect(onGiveUp).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onGiveUp).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does nothing when the context comes back in time, or after cleanup', () => {
    const target = new EventTarget()
    const onGiveUp = vi.fn()
    const stop = watchContextLoss(target, onGiveUp, 2000)
    lose(target)
    vi.advanceTimersByTime(500)
    target.dispatchEvent(new Event('webglcontextrestored'))
    vi.advanceTimersByTime(5000)
    expect(onGiveUp).not.toHaveBeenCalled()

    lose(target)
    stop()
    vi.advanceTimersByTime(5000)
    expect(onGiveUp).not.toHaveBeenCalled()
  })
})
