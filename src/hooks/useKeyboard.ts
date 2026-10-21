import { useEffect } from 'react'
import { sfx } from '../audio/sfx'
import { tapeBySlot } from '../content/work'
import { dispatchScreenKey } from '../screens/input'
import { openResume } from '../screens/links'
import { focusedDevices, isCdKey, isRepeatableCdKey, isScreenKey } from '../screens/routing'
import { requestSectionFocus } from '../seo/focus'
import { useStore, type AppState } from '../state/store'
import { isCleared, keyFromKeyboard } from '../three/objects/calc/engine'

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const CONTROL_TAGS = new Set(['BUTTON', 'A'])

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable)
}

/**
 * A link/button the user reached with the keyboard. Mouse clicks also focus
 * links in Chromium, but without :focus-visible, so shortcuts keep working
 * right after clicking a nav pill.
 */
function isFocusedControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && CONTROL_TAGS.has(target.tagName) && target.matches(':focus-visible')
}

/** Held keys that keep repeating (pager scrolling, channel surfing). */
const REPEATABLE_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'])

/**
 * The held calculator takes its keys (digits, + - * / . , = Enter, Backspace,
 * Delete = CE, c = C) before any shortcut, Shift included (+ and * are
 * shifted keys). Esc clears it first and puts it down once it reads a clean 0.
 */
function calculatorKey(event: KeyboardEvent, state: AppState): boolean {
  if (event.key === 'Escape') {
    if (event.repeat) return false
    if (isCleared(state.calc)) state.back()
    else dispatchScreenKey(['calculator'], 'Escape')
    return true
  }
  return keyFromKeyboard(event.key) !== null && dispatchScreenKey(['calculator'], event.key)
}

/**
 * Global shortcuts: C → #about, Z → toggle TV zoom, M → toggle the CD player
 * close-up, Esc → put the CV card back, leave a close-up, then home,
 * Enter with the CV card up → open the CV in a new tab,
 * 1–8 on #work → tape N; while the BBS dials (#online) any key skips it.
 * Arrows / Enter / Space / PageUp / PageDown / digits then go to the focused
 * screen's channel (PC on about/online, notepad then TV on work, the CD
 * player's buttons in its close-up, plus S stop, D disc and − / + volume
 * there). Ignored with modifiers, while typing,
 * and (except Esc, so "ESC always goes back") while a link/button has
 * keyboard focus. Keyboard page changes move focus to the section heading
 * (SEO layer). Inactive until the gate is passed (the loader owns Enter /
 * Space there); the readable fallback keeps them.
 */
export function handleShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (isEditable(event.target)) return false

  const state = useStore.getState()
  if (state.phase !== 'live' && state.phase !== 'fallback') return false
  if (state.calcUp && state.phase === 'live' && calculatorKey(event, state)) return true
  // The CV card is up: Enter opens the CV in a new tab (a held key opens it once). A focused
  // link/button keeps its own Enter.
  if (state.cvOpen && event.key === 'Enter' && !event.shiftKey && !isFocusedControl(event.target)) {
    if (!event.repeat) openResume()
    return true
  }
  // The CD close-up takes S (stop), D (disc) and − / + (volume), Shift included (+ is a shifted key).
  if (state.zoom === 'cd' && state.phase === 'live' && isCdKey(event.key) && !isFocusedControl(event.target)) {
    if (event.repeat && !isRepeatableCdKey(event.key)) return true
    return dispatchScreenKey(['cd'], event.key)
  }
  if (event.shiftKey) return false
  if (event.key === 'Escape') {
    if (event.repeat) return false
    // The CV card goes back first (no page change, no focus move).
    if (!state.cvOpen && state.zoom === null && state.route.page !== 'home') requestSectionFocus()
    state.back({ recenter: true })
    return true
  }
  if (isFocusedControl(event.target)) return false
  if (event.repeat) return REPEATABLE_KEYS.has(event.key) && dispatchScreenKey(focusedDevices(state), event.key)
  // Any key (but Tab, which moves focus) skips the BBS dial-up on #online.
  if (state.bbs === 'dialing' && event.key !== 'Tab') return dispatchScreenKey(['pc'], event.key)

  const key = event.key.toLowerCase()
  if (key === 'c') {
    if (state.route.page !== 'about') requestSectionFocus()
    state.navigate('#about')
    return true
  }
  if (key === 'z') {
    state.toggleZoom()
    return true
  }
  if (key === 'm' && state.phase === 'live') {
    state.toggleCdView()
    return true
  }
  if (/^[1-8]$/.test(key) && state.route.page === 'work') {
    const tape = tapeBySlot(Number(key))
    if (tape) {
      state.navigate(`#work/${tape.id}`)
      return true
    }
  }
  if (isScreenKey(event.key)) return dispatchScreenKey(focusedDevices(state), event.key)
  return false
}

export function useKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The calculator's keys click softer than the room's shortcuts.
      const calculator = useStore.getState().calcUp
      if (!handleShortcut(event)) return
      event.preventDefault()
      sfx(calculator ? 'calc' : 'key')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
