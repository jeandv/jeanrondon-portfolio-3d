import { describe, expect, it } from 'vitest'
import { DISCS } from '../audio/music/discs'
import { cdKeyButton, lcdLine, scrollWindow, type CdLcdView } from './channels/cd/lcd'
import { buttonUv, CD_BUTTON_ORDER, CD_BUTTONS, CD_LCD_SIZE } from './channels/cd/layout'
import { isCdKey, isRepeatableCdKey } from './routing'

const VIEW: CdLcdView = {
  lid: 'closed',
  disc: DISCS.joji,
  status: 'playing',
  track: 1,
  elapsed: 12,
  duration: 200,
  muted: false,
  volume: 80,
  error: false,
}

describe('CD player front strip', () => {
  it('has seven keys inside the strip, right of the LCD, never overlapping', () => {
    expect(CD_BUTTON_ORDER).toEqual(['prev', 'play', 'next', 'stop', 'voldown', 'volup', 'disc'])
    const rects = CD_BUTTON_ORDER.map((button) => CD_BUTTONS[button])
    rects.forEach((rect, i) => {
      expect(rect.x).toBeGreaterThan(456)
      expect(rect.x + rect.w).toBeLessThanOrEqual(CD_LCD_SIZE.width)
      expect(rect.y + rect.h).toBeLessThanOrEqual(CD_LCD_SIZE.height)
      expect(rect.w).toBeGreaterThanOrEqual(48)
      rects.forEach((other, j) => {
        if (j <= i) return
        const apart = rect.x + rect.w <= other.x || other.x + other.w <= rect.x || rect.y + rect.h <= other.y || other.y + other.h <= rect.y
        expect(apart).toBe(true)
      })
    })
    const { u, v } = buttonUv('disc')
    expect(u).toBeGreaterThan(0.5)
    expect(v).toBeGreaterThan(0.5)
  })

  it('scrolls the playing track, the disc when stopped, ERR while skipping, OPEN with the lid up', () => {
    expect(lcdLine(VIEW)).toBe('02 SLOW DANCING IN THE DARK - JOJI')
    expect(lcdLine({ ...VIEW, status: 'stopped' })).toBe('DISC 2 JOJI - 4 TRACKS - VIA YOUTUBE')
    expect(lcdLine({ ...VIEW, disc: DISCS.tapes, status: 'stopped', track: 0 })).toBe(
      `DISC 1 ${DISCS.tapes.title} - ${DISCS.tapes.tracks.length} TRACKS`.toUpperCase(),
    )
    expect(lcdLine({ ...VIEW, error: true })).toBe('02 CANNOT PLAY - SKIPPING')
    expect(lcdLine({ ...VIEW, lid: 'open' })).toBe('OPEN - DISC 2 JOJI')
    expect(scrollWindow('ABCDEFGHIJ', 4, 0)).toBe('ABCD')
    expect(scrollWindow('ABC', 4, 9)).toBe('ABC')
  })

  it('maps the close-up keys: Space play, ←→ track, ↑↓ / − + volume, S stop, D disc', () => {
    expect(cdKeyButton(' ')).toBe('play')
    expect(cdKeyButton('Enter')).toBe('play')
    expect(cdKeyButton('ArrowRight')).toBe('next')
    expect(cdKeyButton('ArrowLeft')).toBe('prev')
    expect(cdKeyButton('ArrowUp')).toBe('volup')
    expect(cdKeyButton('+')).toBe('volup')
    expect(cdKeyButton('=')).toBe('volup')
    expect(cdKeyButton('ArrowDown')).toBe('voldown')
    expect(cdKeyButton('-')).toBe('voldown')
    expect(cdKeyButton('s')).toBe('stop')
    expect(cdKeyButton('D')).toBe('disc')
    expect(cdKeyButton('x')).toBeNull()
    expect(isCdKey('s') && isCdKey('d') && isCdKey('-') && isCdKey('+')).toBe(true)
    expect(isCdKey('m') || isCdKey('c') || isCdKey('z')).toBe(false)
    expect(isRepeatableCdKey('+')).toBe(true)
    expect(isRepeatableCdKey('d')).toBe(false)
  })
})
