/**
 * Persisted visitor choices. Every storage access is wrapped: private modes,
 * blocked cookies or sandboxed frames make `localStorage` throw.
 */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** sessionStorage: the visitor passed the gate in this tab session. */
export const ENTERED_KEY = 'jr3d:entered'
/** localStorage: last sound choice ('1' muted, '0' sound on). */
export const MUTED_KEY = 'jr3d:muted'
/** sessionStorage: the full BBS dial-up already played in this tab session. */
export const DIALED_KEY = 'jr3d:dialed'

/** The browser storage, or null when it is unavailable or throws. */
export function browserStorage(kind: 'local' | 'session'): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function read(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(storage: StorageLike | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Quota or privacy mode: the choice just is not remembered.
  }
}

/** Returning visitor in this session: skip the gate (auto-enter). */
export function hasEnteredThisSession(storage: StorageLike | null = browserStorage('session')): boolean {
  return read(storage, ENTERED_KEY) === '1'
}

export function rememberEntered(storage: StorageLike | null = browserStorage('session')): void {
  write(storage, ENTERED_KEY, '1')
}

/** Persisted mute choice, or null when there is none. */
export function loadMuted(storage: StorageLike | null = browserStorage('local')): boolean | null {
  const value = read(storage, MUTED_KEY)
  return value === '1' ? true : value === '0' ? false : null
}

export function saveMuted(muted: boolean, storage: StorageLike | null = browserStorage('local')): void {
  write(storage, MUTED_KEY, muted ? '1' : '0')
}

/** The full dial-up played in this session: later visits to #online just reconnect. */
export function hasDialedThisSession(storage: StorageLike | null = browserStorage('session')): boolean {
  return read(storage, DIALED_KEY) === '1'
}

export function rememberDialed(storage: StorageLike | null = browserStorage('session')): void {
  write(storage, DIALED_KEY, '1')
}
