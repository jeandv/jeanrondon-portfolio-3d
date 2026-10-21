import { describe, expect, it } from 'vitest'
import {
  CALC_RESET,
  calcPress,
  calcRun,
  digitCount,
  ERROR_DISPLAY,
  formatNumber,
  isCleared,
  isWink,
  keyFromKeyboard,
  MAX_DIGITS,
  type CalcKey,
} from './engine'

/** Keys from a compact script: digits, `.`, + - * /, `=`, and C / E (CE) / N (±) / B (backspace). */
function keys(script: string): CalcKey[] {
  return [...script.replace(/\s+/g, '')].map((char): CalcKey => {
    switch (char) {
      case 'E':
        return 'CE'
      case 'N':
        return 'neg'
      case 'B':
        return 'back'
      default:
        return char as CalcKey
    }
  })
}

const run = (script: string) => calcRun(keys(script))
const shows = (script: string) => run(script).display

describe('calculator: entry', () => {
  it('starts at 0 and types digits, dropping leading zeros', () => {
    expect(CALC_RESET.display).toBe('0')
    expect(shows('7')).toBe('7')
    expect(shows('007')).toBe('7')
    expect(shows('000')).toBe('0')
    expect(shows('120')).toBe('120')
  })

  it('takes at most 10 digits (sign and point are free)', () => {
    expect(shows('12345678901234')).toBe('1234567890')
    expect(digitCount(shows('12345678901234'))).toBe(MAX_DIGITS)
    expect(shows('1.234567890123')).toBe('1.234567890')
    expect(shows('123456789N0')).toBe('-1234567890')
  })

  it('handles the decimal point: one per number, a leading 0., trailing zeros while typing', () => {
    expect(shows('.5')).toBe('0.5')
    expect(shows('1..5')).toBe('1.5')
    expect(shows('1.5.2')).toBe('1.52')
    expect(shows('2.50')).toBe('2.50')
    expect(shows('2.50=')).toBe('2.5')
    expect(shows('3.=')).toBe('3')
  })

  it('± toggles the sign of the entry (not of 0) and negates a result', () => {
    expect(shows('5N')).toBe('-5')
    expect(shows('5NN')).toBe('5')
    expect(shows('N')).toBe('0')
    expect(shows('0.N')).toBe('0.')
    expect(shows('2+3=N')).toBe('-5')
    expect(shows('5N+2=')).toBe('-3')
    expect(shows('5N0')).toBe('-50')
  })

  it('backspace deletes the last typed character, never a result', () => {
    expect(shows('123B')).toBe('12')
    expect(shows('1BB')).toBe('0')
    expect(shows('5NB')).toBe('0')
    expect(shows('1.5B')).toBe('1.')
    expect(shows('2+3=B')).toBe('5')
  })
})

describe('calculator: operations', () => {
  it('adds, subtracts, multiplies and divides', () => {
    expect(shows('12+30=')).toBe('42')
    expect(shows('7-10=')).toBe('-3')
    expect(shows('6*7=')).toBe('42')
    expect(shows('1/4=')).toBe('0.25')
  })

  it('chains operations left to right (immediate execution), showing each partial result', () => {
    expect(shows('2+3*')).toBe('5')
    expect(shows('2+3*4=')).toBe('20')
    expect(shows('10-2-3=')).toBe('5')
    expect(shows('100/4/5=')).toBe('5')
  })

  it('a second operator replaces the first', () => {
    expect(shows('8+-2=')).toBe('6')
    expect(shows('8*/2=')).toBe('4')
  })

  it('= repeats the last operation; op then = uses the shown value', () => {
    expect(shows('5+3==')).toBe('11')
    expect(shows('5+3===')).toBe('14')
    expect(shows('2*3==')).toBe('18')
    expect(shows('5+=')).toBe('10')
    expect(shows('5+==')).toBe('15')
    // A new number then = applies the remembered operation to it (constant).
    expect(shows('5+3=2=')).toBe('5')
    // An operator after = starts from the result.
    expect(shows('5+3=*2=')).toBe('16')
  })

  it('= alone just tidies the entry', () => {
    expect(shows('=')).toBe('0')
    expect(shows('4.=')).toBe('4')
  })

  it('rounds results to what fits on the LCD and avoids float noise', () => {
    expect(shows('1/3=')).toBe('0.333333333')
    expect(shows('2/3=')).toBe('0.666666667')
    expect(shows('.1+.2=')).toBe('0.3')
    expect(shows('1/8=')).toBe('0.125')
    expect(shows('123456789/10=')).toBe('12345678.9')
    expect(shows('1/1000000000=')).toBe('0.000000001')
    // Typing stops at 10 digits, so 1 / 10^10 needs two steps; it underflows to 0.
    expect(shows('1/10000000000=')).toBe('0.000000001')
    expect(shows('1/1000000000/10=')).toBe('0')
  })
})

describe('calculator: errors', () => {
  it('divide by zero shows E and locks the keys until C or CE', () => {
    const error = run('7/0=')
    expect(error.display).toBe(ERROR_DISPLAY)
    expect(error.error).toBe(true)
    expect(calcRun(keys('5+5=N.'), error)).toEqual(error)
    expect(calcPress(error, 'C')).toEqual(CALC_RESET)
    expect(calcPress(error, 'CE')).toEqual(CALC_RESET)
    // A chained division by zero errors right away.
    expect(shows('8/0+')).toBe(ERROR_DISPLAY)
  })

  it('overflow past 10 digits shows E', () => {
    expect(shows('9999999999+1=')).toBe(ERROR_DISPLAY)
    expect(shows('100000*100000=')).toBe(ERROR_DISPLAY)
    expect(shows('9999999999*9999999999N=')).toBe(ERROR_DISPLAY)
    // Overflow mid-chain errors at once.
    expect(shows('99999*99999*10+')).toBe(ERROR_DISPLAY)
    // Just fits.
    expect(shows('9999999998+1=')).toBe('9999999999')
    expect(shows('99999*99999=')).toBe('9999800001')
  })

  it('formatNumber: E for non-finite and too large, rounding that would overflow, -0 → 0', () => {
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(ERROR_DISPLAY)
    expect(formatNumber(Number.NaN)).toBe(ERROR_DISPLAY)
    expect(formatNumber(1e10)).toBe(ERROR_DISPLAY)
    expect(formatNumber(-1e10)).toBe(ERROR_DISPLAY)
    expect(formatNumber(9999999999.7)).toBe(ERROR_DISPLAY)
    expect(formatNumber(-0)).toBe('0')
    expect(formatNumber(-1e-12)).toBe('0')
    expect(formatNumber(-2.5)).toBe('-2.5')
    expect(formatNumber(1234.5678901234)).toBe('1234.56789')
    expect(formatNumber(1234.5678951234)).toBe('1234.567895')
  })
})

describe('calculator: clearing', () => {
  it('C clears everything', () => {
    expect(calcRun(keys('12+3C'))).toEqual(CALC_RESET)
    expect(shows('12+3C4=')).toBe('4')
  })

  it('CE clears the entry and keeps the pending operation', () => {
    expect(shows('5+3E4=')).toBe('9')
    expect(shows('5+3E=')).toBe('5')
    expect(shows('5+3=E')).toBe('0')
  })

  it('isCleared: only a fresh 0 with nothing pending', () => {
    expect(isCleared(CALC_RESET)).toBe(true)
    expect(isCleared(run('5'))).toBe(false)
    expect(isCleared(run('5+'))).toBe(false)
    expect(isCleared(run('5+3=C'))).toBe(true)
    expect(isCleared(run('7/0='))).toBe(false)
  })
})

describe('calculator: keyboard and the wink', () => {
  it('maps physical keys', () => {
    expect(keyFromKeyboard('7')).toBe('7')
    expect(keyFromKeyboard('+')).toBe('+')
    expect(keyFromKeyboard('-')).toBe('-')
    expect(keyFromKeyboard('*')).toBe('*')
    expect(keyFromKeyboard('x')).toBe('*')
    expect(keyFromKeyboard('/')).toBe('/')
    expect(keyFromKeyboard('Enter')).toBe('=')
    expect(keyFromKeyboard('=')).toBe('=')
    expect(keyFromKeyboard(',')).toBe('.')
    expect(keyFromKeyboard('Backspace')).toBe('back')
    expect(keyFromKeyboard('Delete')).toBe('CE')
    expect(keyFromKeyboard('c')).toBe('C')
    expect(keyFromKeyboard('Escape')).toBeNull()
    expect(keyFromKeyboard('a')).toBeNull()
    expect(keyFromKeyboard('ArrowUp')).toBeNull()
  })

  it('winks at 58008 and 0.7734 only', () => {
    expect(isWink(run('58008'))).toBe(true)
    expect(isWink(run('.7734'))).toBe(true)
    expect(isWink(run('58000+8='))).toBe(true)
    expect(isWink(run('5800'))).toBe(false)
    expect(isWink(run('0.77341'))).toBe(false)
  })
})
