import { useEffect } from 'react'
import { tapeBySlot } from '../content/work'
import { dispatchScreenKey } from '../screens/input'
import { focusedDevices, isScreenKey } from '../screens/routing'
import { requestSectionFocus } from '../seo/focus'
import { useStore } from '../state/store'

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
 * Global shortcuts: C → #about, Z → toggle TV zoom, Esc → leave zoom then
 * home, 1–8 on #work → tape N. Arrows / Enter / Space / PageUp / PageDown /
 * digits then go to the focused screen's channel (PC on about/online, notepad
 * then TV on work). Ignored with modifiers, while typing, and (except Esc,
 * so "ESC always goes back") while a link/button has keyboard focus.
 * Keyboard page changes move focus to the section heading (SEO layer).
 */
export function handleShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
  if (isEditable(event.target)) return false

  const state = useStore.getState()
  if (event.key === 'Escape') {
    if (event.repeat) return false
    if (state.zoom === null && state.route.page !== 'home') requestSectionFocus()
    state.back({ recenter: true })
    return true
  }
  if (isFocusedControl(event.target)) return false
  if (event.repeat) return REPEATABLE_KEYS.has(event.key) && dispatchScreenKey(focusedDevices(state), event.key)

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
      if (handleShortcut(event)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
