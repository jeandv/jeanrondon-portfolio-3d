import { describe, expect, it } from 'vitest'
import {
  browserStorage,
  DIALED_KEY,
  ENTERED_KEY,
  hasDialedThisSession,
  hasEnteredThisSession,
  loadMuted,
  MUTED_KEY,
  rememberDialed,
  rememberEntered,
  saveMuted,
  type StorageLike,
} from './session'

function memoryStorage(): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError')
  },
}

describe('gate skip (sessionStorage)', () => {
  it('shows the gate on the first visit of a session and skips it after entering', () => {
    const session = memoryStorage()
    expect(hasEnteredThisSession(session)).toBe(false)
    rememberEntered(session)
    expect(session.data.get(ENTERED_KEY)).toBe('1')
    expect(hasEnteredThisSession(session)).toBe(true)
  })

  it('only trusts the exact flag', () => {
    const session = memoryStorage()
    session.setItem(ENTERED_KEY, 'true')
    expect(hasEnteredThisSession(session)).toBe(false)
  })

  it('shows the gate when storage is missing or throws, and never throws itself', () => {
    expect(hasEnteredThisSession(null)).toBe(false)
    expect(hasEnteredThisSession(throwingStorage)).toBe(false)
    expect(() => rememberEntered(throwingStorage)).not.toThrow()
    expect(() => rememberEntered(null)).not.toThrow()
  })

  it('has no browser storage outside the browser', () => {
    expect(browserStorage('session')).toBeNull()
    expect(browserStorage('local')).toBeNull()
    expect(hasEnteredThisSession()).toBe(false)
  })
})

describe('mute persistence (localStorage)', () => {
  it('round-trips the choice', () => {
    const local = memoryStorage()
    expect(loadMuted(local)).toBeNull()
    saveMuted(true, local)
    expect(local.data.get(MUTED_KEY)).toBe('1')
    expect(loadMuted(local)).toBe(true)
    saveMuted(false, local)
    expect(loadMuted(local)).toBe(false)
  })

  it('ignores garbage and failing storage', () => {
    const local = memoryStorage()
    local.setItem(MUTED_KEY, 'maybe')
    expect(loadMuted(local)).toBeNull()
    expect(loadMuted(throwingStorage)).toBeNull()
    expect(() => saveMuted(true, throwingStorage)).not.toThrow()
  })
})

describe('BBS dial-up once per session (sessionStorage)', () => {
  it('plays the full dial-up the first time, then remembers it', () => {
    const session = memoryStorage()
    expect(hasDialedThisSession(session)).toBe(false)
    rememberDialed(session)
    expect(session.data.get(DIALED_KEY)).toBe('1')
    expect(hasDialedThisSession(session)).toBe(true)
  })

  it('dials in full again when storage is missing or throws (and never throws)', () => {
    expect(hasDialedThisSession(null)).toBe(false)
    expect(hasDialedThisSession(throwingStorage)).toBe(false)
    expect(() => rememberDialed(throwingStorage)).not.toThrow()
    expect(() => rememberDialed(null)).not.toThrow()
    const session = memoryStorage()
    session.setItem(DIALED_KEY, 'yes')
    expect(hasDialedThisSession(session)).toBe(false)
  })
})
