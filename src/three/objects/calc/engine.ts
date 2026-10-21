/**
 * Desk calculator logic (pure, three-free: the store and the canvas keypad use
 * it). A classic four-function, immediate-execution pocket calculator:
 * `2 + 3 × 4 =` is 20; `=` again repeats the last operation (`5 + 3 = =` is
 * 11); `5 + =` adds the shown value to itself; dividing by zero or leaving
 * the 10 digits of the LCD shows `E` until C (or CE) clears it.
 */

export type CalcOp = '+' | '-' | '*' | '/'
export type CalcDigit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
/** Every key of the keypad (and its keyboard equivalents). */
export type CalcKey = CalcDigit | '.' | CalcOp | '=' | 'C' | 'CE' | 'neg' | 'back'

/** Digits the LCD shows (the sign and the decimal point take no digit). */
export const MAX_DIGITS = 10
/** The LCD's error readout. */
export const ERROR_DISPLAY = 'E'

export interface CalcState {
  /** What the LCD reads: the number being typed, the last result or `E`. */
  readonly display: string
  /** Left operand of the pending operation. */
  readonly acc: number | null
  readonly op: CalcOp | null
  /** The display is a number being typed (digits append to it). */
  readonly entering: boolean
  /** The last `=` operation, repeated by another `=`. */
  readonly repeat: { readonly op: CalcOp; readonly operand: number } | null
  readonly error: boolean
}

export const CALC_RESET: CalcState = { display: '0', acc: null, op: null, entering: false, repeat: null, error: false }

const DIGITS = new Set<string>(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

export function isDigit(key: string): key is CalcDigit {
  return DIGITS.has(key)
}

export function isOp(key: string): key is CalcOp {
  return key === '+' || key === '-' || key === '*' || key === '/'
}

/** Digits in a display string (sign and point excluded). */
export function digitCount(display: string): number {
  let count = 0
  for (const char of display) if (DIGITS.has(char)) count++
  return count
}

/** Numeric value of a display string (`E` and partial entries like `-` read as 0). */
export function valueOf(display: string): number {
  const value = Number.parseFloat(display)
  return Number.isFinite(value) ? value : 0
}

/**
 * A result as the LCD shows it: at most MAX_DIGITS digits, rounded to the
 * decimals that fit, trailing zeros trimmed; `E` once it does not fit (or
 * is not a number). Underflow reads 0.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ERROR_DISPLAY
  const magnitude = Math.abs(value)
  if (magnitude >= 10 ** MAX_DIGITS) return ERROR_DISPLAY
  const whole = magnitude < 1 ? 1 : Math.floor(Math.log10(magnitude)) + 1
  const decimals = Math.max(0, MAX_DIGITS - whole)
  let text = value.toFixed(decimals)
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
  if (text === '-0') text = '0'
  // Rounding up can add a digit (9999999999.7 → 10000000000).
  return digitCount(text) > MAX_DIGITS ? ERROR_DISPLAY : text
}

function apply(a: number, op: CalcOp, b: number): number | null {
  switch (op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      return b === 0 ? null : a / b
  }
}

const errorState: CalcState = { ...CALC_RESET, display: ERROR_DISPLAY, error: true }

/** Runs `a op b` into a shown result (or the error state). */
function result(state: CalcState, a: number, op: CalcOp, b: number, extra: Partial<CalcState>): CalcState {
  const value = apply(a, op, b)
  const display = value === null ? ERROR_DISPLAY : formatNumber(value)
  if (display === ERROR_DISPLAY) return errorState
  return { ...state, ...extra, display, entering: false, error: false }
}

function typeDigit(state: CalcState, digit: CalcDigit): CalcState {
  if (!state.entering) return { ...state, display: digit, entering: true }
  if (digitCount(state.display) >= MAX_DIGITS) return state
  if (state.display === '0') return { ...state, display: digit }
  if (state.display === '-0') return { ...state, display: `-${digit}` }
  return { ...state, display: state.display + digit }
}

function typePoint(state: CalcState): CalcState {
  if (!state.entering) return { ...state, display: '0.', entering: true }
  if (state.display.includes('.') || digitCount(state.display) >= MAX_DIGITS) return state
  return { ...state, display: `${state.display}.` }
}

function pressOp(state: CalcState, op: CalcOp): CalcState {
  if (state.op !== null && state.acc !== null && state.entering) {
    // Chained: 2 + 3 × → 5 ×
    const chained = result(state, state.acc, state.op, valueOf(state.display), {})
    return chained.error ? chained : { ...chained, acc: valueOf(chained.display), op, repeat: null }
  }
  if (state.op !== null && !state.entering) return { ...state, op }
  return { ...state, acc: valueOf(state.display), op, entering: false, repeat: null }
}

function pressEquals(state: CalcState): CalcState {
  const shown = valueOf(state.display)
  if (state.op !== null && state.acc !== null) {
    return result(state, state.acc, state.op, shown, { acc: null, op: null, repeat: { op: state.op, operand: shown } })
  }
  if (state.repeat) return result(state, shown, state.repeat.op, state.repeat.operand, {})
  return { ...state, display: formatNumber(shown), entering: false }
}

function negate(state: CalcState): CalcState {
  if (state.entering) {
    if (state.display === '0' || state.display === '0.') return state
    const display = state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`
    return { ...state, display }
  }
  const value = valueOf(state.display)
  return value === 0 ? state : { ...state, display: formatNumber(-value) }
}

function backspace(state: CalcState): CalcState {
  if (!state.entering) return state
  const display = state.display.slice(0, -1)
  return { ...state, display: display === '' || display === '-' ? '0' : display }
}

/** The calculator after one key press (pure; unchanged when the key does nothing). */
export function calcPress(state: CalcState, key: CalcKey): CalcState {
  if (key === 'C') return CALC_RESET
  if (state.error) return key === 'CE' ? CALC_RESET : state
  if (isDigit(key)) return typeDigit(state, key)
  if (isOp(key)) return pressOp(state, key)
  switch (key) {
    case '.':
      return typePoint(state)
    case '=':
      return pressEquals(state)
    case 'CE':
      return { ...state, display: '0', entering: false }
    case 'neg':
      return negate(state)
    case 'back':
      return backspace(state)
  }
}

/** Presses a sequence of keys (tests, scripted demos). */
export function calcRun(keys: readonly CalcKey[], state: CalcState = CALC_RESET): CalcState {
  return keys.reduce(calcPress, state)
}

/** Nothing to clear: a fresh calculator showing 0 (Esc then puts it down instead of clearing). */
export function isCleared(state: CalcState): boolean {
  return !state.error && state.display === '0' && state.op === null && state.acc === null
}

/** The two classic upside-down words: 58008 and 0.7734 ("hELLO") earn a tiny wink on the LCD. */
export function isWink(state: CalcState): boolean {
  return state.display === '58008' || state.display === '0.7734'
}

/** Physical keyboard → calculator key (`KeyboardEvent.key`), null for anything else. */
export function keyFromKeyboard(key: string): CalcKey | null {
  if (isDigit(key) || isOp(key)) return key
  switch (key) {
    case '.':
    case ',':
      return '.'
    case 'x':
    case 'X':
      return '*'
    case '=':
    case 'Enter':
      return '='
    case 'Backspace':
      return 'back'
    case 'Delete':
      return 'CE'
    case 'c':
    case 'C':
      return 'C'
    case 'n':
    case 'N':
    case 'F9':
      return 'neg'
    default:
      return null
  }
}
