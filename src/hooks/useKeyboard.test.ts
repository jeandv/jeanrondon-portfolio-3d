import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESUME } from '../content/resume'
import { useStore } from '../state/store'
import { handleShortcut } from './useKeyboard'

/** A link/button with keyboard focus (what `isFocusedControl` looks for). */
class FakeElement {
  readonly tagName = 'A'
  readonly isContentEditable = false
  matches(selector: string): boolean {
    return selector === ':focus-visible'
  }
}

function key(name: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: name,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    ...overrides,
  } as KeyboardEvent
}

const open = vi.fn()

beforeEach(() => {
  open.mockReset()
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('window', { open, location: { href: '', hash: '' } })
  useStore.setState({ phase: 'live', zoom: null, cvOpen: false, calcUp: false, route: { page: 'home' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CV card keys', () => {
  it('Enter with the card up opens the CV in a new tab (noopener) and leaves the card up', () => {
    useStore.getState().setCvOpen(true)
    expect(handleShortcut(key('Enter'))).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(RESUME.url, '_blank', 'noopener,noreferrer')
    expect(useStore.getState().cvOpen).toBe(true)
  })

  it('a held Enter opens it once', () => {
    useStore.getState().setCvOpen(true)
    expect(handleShortcut(key('Enter', { repeat: true }))).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it('Enter does not open the CV while the card is filed away', () => {
    handleShortcut(key('Enter'))
    expect(open).not.toHaveBeenCalled()
  })

  it('a focused link keeps its own Enter', () => {
    useStore.getState().setCvOpen(true)
    expect(handleShortcut(key('Enter', { target: new FakeElement() as unknown as EventTarget }))).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('Esc files the card away (still at the desk)', () => {
    useStore.getState().setCvOpen(true)
    expect(handleShortcut(key('Escape'))).toBe(true)
    expect(useStore.getState().cvOpen).toBe(false)
    expect(useStore.getState().route).toEqual({ page: 'home' })
  })
})
