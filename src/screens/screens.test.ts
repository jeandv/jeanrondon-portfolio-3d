import { describe, expect, it, vi } from 'vitest'
import { CONTACT_MENU } from '../content/contactMenu'
import { LINKS } from '../content/links'
import { PROFILE } from '../content/profile'
import { RESUME } from '../content/resume'
import type { Tape } from '../content/types'
import { TAPES } from '../content/work'
import { effectiveFps, OFFSCREEN_FPS, redrawDue, TRANSITION_FPS } from './CanvasScreen'
import type { ChannelContext } from './channel'
import { adjacentTape, createNotepadChannel, notepadOrder, notepadRows } from './channels/notepad/work'
import { aboutParagraphs, pagerLines, pagerRows } from './channels/pc/about'
import { contactRow, createContactChannel } from './channels/pc/contact'
import { createTapeChannel } from './channels/tv/tape'
import { formatCounter } from './draw'
import { hitTest, uvToCanvas, type HitRect } from './hit'
import { dispatchScreenKey, registerScreenKeys } from './input'
import { isAtEnd, pageDown, pagerStatus, pageUp, percentShown, scrollBy, typedLengths } from './pager'
import { initialsOf } from './polaroid'
import { focusedDevices, isInteractive, isScreenKey, pcChannelFor, tvChannelFor } from './routing'
import { ellipsize, fitSize, monoMeasure, wrapText } from './text'

function fakeContext(overrides: Partial<ChannelContext> = {}): ChannelContext {
  return {
    width: 640,
    height: 480,
    reducedMotion: false,
    hover: null,
    time: 0,
    invalidate: vi.fn(),
    navigate: vi.fn(),
    openLink: vi.fn(),
    ...overrides,
  }
}

describe('hit rects', () => {
  const rects: HitRect[] = [
    { id: 'a', x: 10, y: 10, w: 100, h: 40 },
    { id: 'b', x: 60, y: 30, w: 100, h: 40 },
  ]

  it('maps glTF UVs ((0,0) top-left) straight to canvas pixels', () => {
    expect(uvToCanvas({ x: 0, y: 0 }, 640, 480)).toEqual({ x: 0, y: 0 })
    expect(uvToCanvas({ x: 0.5, y: 0.25 }, 640, 480)).toEqual({ x: 320, y: 120 })
    expect(uvToCanvas({ x: 1, y: 1 }, 512, 832)).toEqual({ x: 512, y: 832 })
  })

  it('flips v for three-native UVs', () => {
    expect(uvToCanvas({ x: 0.5, y: 0.25 }, 640, 480, true)).toEqual({ x: 320, y: 360 })
  })

  it('returns the topmost rect under the point, edges half-open', () => {
    expect(hitTest(rects, 20, 20)?.id).toBe('a')
    expect(hitTest(rects, 80, 40)?.id).toBe('b')
    expect(hitTest(rects, 110, 20)).toBeNull()
    expect(hitTest(rects, 10, 10)?.id).toBe('a')
    expect(hitTest(rects, 5, 5)).toBeNull()
  })

  it('round-trips a UV hit onto the right rect', () => {
    const point = uvToCanvas({ x: 30 / 640, y: 25 / 480 }, 640, 480)
    expect(hitTest(rects, point.x, point.y)?.id).toBe('a')
  })
})

describe('text layout', () => {
  const mono = monoMeasure(1)

  it('wraps on words and keeps blank paragraphs', () => {
    expect(wrapText('the quick brown fox', 10, mono)).toEqual(['the quick', 'brown fox'])
    expect(wrapText('one\n\ntwo', 10, mono)).toEqual(['one', '', 'two'])
  })

  it('hard-breaks words longer than the line', () => {
    expect(wrapText('abcdefghijkl', 5, mono)).toEqual(['abcde', 'fghij', 'kl'])
  })

  it('ellipsizes and fits sizes', () => {
    expect(ellipsize('hello world', 8, mono)).toBe('hello...')
    expect(ellipsize('short', 8, mono)).toBe('short')
    expect(fitSize(100, 60, 20, (size) => size * 2)).toBe(50)
    expect(fitSize(10, 60, 20, (size) => size * 2)).toBe(20)
  })
})

describe('pager', () => {
  const total = 40
  const rows = 15

  it('pages down, clamps the last page and wraps to the top', () => {
    expect(pageDown(0, total, rows)).toBe(15)
    expect(pageDown(15, total, rows)).toBe(25)
    expect(isAtEnd(25, total, rows)).toBe(true)
    expect(pageDown(25, total, rows)).toBe(0)
  })

  it('pages up and scrolls within bounds', () => {
    expect(pageUp(25, total, rows)).toBe(10)
    expect(pageUp(5, total, rows)).toBe(0)
    expect(scrollBy(0, -1, total, rows)).toBe(0)
    expect(scrollBy(24, 5, total, rows)).toBe(25)
  })

  it('reports the share shown like `more`', () => {
    expect(percentShown(0, total, rows)).toBe(38)
    expect(pagerStatus(0, total, rows)).toBe('-- MORE (38%) --')
    expect(pagerStatus(25, total, rows)).toBe('-- END --')
    expect(pagerStatus(0, 10, rows)).toBe('-- END --')
  })

  it('types lines in order, blank lines costing one character', () => {
    const lines = ['abc', '', 'de']
    expect(typedLengths(lines, 0, 3, 0, 0)).toEqual([0, 0, 0])
    expect(typedLengths(lines, 0, 3, 0, 2)).toEqual([2, 0, 0])
    expect(typedLengths(lines, 0, 3, 0, 6)).toEqual([3, 0, 1])
    expect(typedLengths(lines, 0, 3, 2, 0)).toEqual([3, 0, 0])
    expect(typedLengths(lines, 0, 3, Number.POSITIVE_INFINITY, 0)).toEqual([3, 0, 2])
  })

  it('wraps the About text to the terminal width', () => {
    const lines = pagerLines(aboutParagraphs(PROFILE), 30)
    expect(lines[0]).toBe('C:\\> TYPE ABOUT.TXT')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30)
    expect(lines.join(' ')).toContain(PROFILE.name.toUpperCase())
    expect(pagerRows(600)).toBe(15)
  })
})

describe('route → channel', () => {
  it('maps the TV per route', () => {
    expect(tvChannelFor({ page: 'home' })).toEqual({ kind: 'home' })
    expect(tvChannelFor({ page: 'about' })).toEqual({ kind: 'home' })
    expect(tvChannelFor({ page: 'online' })).toEqual({ kind: 'home' })
    expect(tvChannelFor({ page: 'work' })).toEqual({ kind: 'insertTape' })
    expect(tvChannelFor({ page: 'work', tape: 'x' })).toEqual({ kind: 'tape', tape: 'x' })
  })

  it('maps the PC per route', () => {
    expect(pcChannelFor({ page: 'about' })).toBe('about')
    expect(pcChannelFor({ page: 'online' })).toBe('contact')
    expect(pcChannelFor({ page: 'home' })).toBe('idle')
    expect(pcChannelFor({ page: 'work', tape: 'x' })).toBe('idle')
  })

  it('routes keys to the device in view', () => {
    expect(focusedDevices({ route: { page: 'about' }, zoom: null })).toEqual(['pc'])
    expect(focusedDevices({ route: { page: 'online' }, zoom: null })).toEqual(['pc'])
    expect(focusedDevices({ route: { page: 'work' }, zoom: null })).toEqual(['notepad', 'tv'])
    expect(focusedDevices({ route: { page: 'home' }, zoom: null })).toEqual([])
    expect(focusedDevices({ route: { page: 'about' }, zoom: 'tv' })).toEqual(['tv'])
  })

  it('only makes screens clickable when the camera is on them', () => {
    expect(isInteractive('pc', { route: { page: 'about' }, zoom: null })).toBe(true)
    expect(isInteractive('pc', { route: { page: 'home' }, zoom: null })).toBe(false)
    expect(isInteractive('notepad', { route: { page: 'work' }, zoom: null })).toBe(true)
    expect(isInteractive('notepad', { route: { page: 'home' }, zoom: null })).toBe(false)
    expect(isInteractive('tv', { route: { page: 'home' }, zoom: 'tv' })).toBe(true)
  })

  it('the CD close-up and the held calculator take the keys and the clicks', () => {
    expect(focusedDevices({ route: { page: 'work' }, zoom: 'cd' })).toEqual(['cd'])
    expect(focusedDevices({ route: { page: 'about' }, zoom: null, calcUp: true })).toEqual(['calculator'])
    expect(isInteractive('cd', { route: { page: 'home' }, zoom: 'cd' })).toBe(true)
    expect(isInteractive('cd', { route: { page: 'home' }, zoom: null })).toBe(false)
    // In the CD close-up on #work the TV is out of the picture.
    expect(isInteractive('tv', { route: { page: 'work' }, zoom: 'cd' })).toBe(false)
    expect(isInteractive('tv', { route: { page: 'work' }, zoom: null })).toBe(true)
    expect(isInteractive('calculator', { route: { page: 'home' }, zoom: null, calcUp: true })).toBe(true)
    expect(isInteractive('calculator', { route: { page: 'home' }, zoom: null })).toBe(false)
    // The held calculator covers the screens behind it.
    expect(isInteractive('pc', { route: { page: 'about' }, zoom: null, calcUp: true })).toBe(false)
  })

  it('forwards only screen keys', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'PageDown', '3']) expect(isScreenKey(key)).toBe(true)
    for (const key of ['c', 'z', 'Escape', 'Tab']) expect(isScreenKey(key)).toBe(false)
  })

  it('dispatches to the first registered device that uses the key', () => {
    const notepad = vi.fn(() => false)
    const tv = vi.fn(() => true)
    const offNotepad = registerScreenKeys('notepad', notepad)
    const offTv = registerScreenKeys('tv', tv)
    expect(dispatchScreenKey(['notepad', 'tv'], 'Enter')).toBe(true)
    expect(notepad).toHaveBeenCalledWith('Enter')
    expect(tv).toHaveBeenCalledWith('Enter')
    offNotepad()
    offTv()
    expect(dispatchScreenKey(['notepad', 'tv'], 'Enter')).toBe(false)
  })
})

describe('screen redraw policy', () => {
  it('drops to 2 fps off-screen and runs transitions at 30', () => {
    expect(effectiveFps(30, true, false)).toBe(30)
    expect(effectiveFps(30, false, false)).toBe(OFFSCREEN_FPS)
    expect(effectiveFps(0, false, false)).toBe(0)
    expect(effectiveFps(2, true, true)).toBe(TRANSITION_FPS)
  })

  it('is due once a frame interval has passed', () => {
    expect(redrawDue(1, Number.NEGATIVE_INFINITY, 2)).toBe(true)
    expect(redrawDue(1.2, 1, 2)).toBe(false)
    expect(redrawDue(1.5, 1, 2)).toBe(true)
    expect(redrawDue(5, 1, 0)).toBe(false)
  })
})

describe('channels', () => {
  it('formats the VCR counter', () => {
    expect(formatCounter(12 * 60 + 31)).toBe('00:12:31')
    expect(formatCounter(3 * 3600 + 5)).toBe('03:00:05')
  })

  it('contact menu: arrows select, Enter/digits/click open the link', () => {
    const channel = createContactChannel(LINKS)
    const ctx = fakeContext({ width: 800, height: 600 })
    channel.enter?.(ctx)
    expect(channel.key?.('ArrowDown', ctx)).toBe(true)
    expect(channel.key?.('Enter', ctx)).toBe(true)
    expect(ctx.openLink).toHaveBeenLastCalledWith(LINKS[1]?.href)
    expect(channel.key?.('1', ctx)).toBe(true)
    expect(ctx.openLink).toHaveBeenLastCalledWith(LINKS[0]?.href)
    expect(channel.key?.('9', ctx)).toBe(false)
    channel.press?.('linkedin', ctx)
    expect(ctx.openLink).toHaveBeenLastCalledWith(LINKS.find((link) => link.id === 'linkedin')?.href)
    expect(channel.hits?.(ctx).map((rect) => rect.id)).toEqual(LINKS.map((link) => link.id))
    expect(contactRow(LINKS[0] ?? { id: 'email', label: '', href: '' }, 0, 60)).toMatch(/^\[1\] EMAIL\s+\S+@/)
  })

  it('contact menu ends with the CV, built from RESUME: its row, key, Enter and click open the CV', () => {
    const count = CONTACT_MENU.length
    expect(count).toBe(LINKS.length + 1)
    expect(CONTACT_MENU.slice(0, LINKS.length)).toEqual(LINKS)
    const cv = CONTACT_MENU[count - 1]
    expect(cv).toEqual({ id: 'cv', label: RESUME.label, href: RESUME.url })
    if (!cv) return
    expect(contactRow(cv, count - 1, 60)).toMatch(new RegExp(`^\\[${count}\\] CV\\s+rxresu\\.me/jeandv/cv-jean-rondon$`))
    expect(contactRow(cv, count - 1, 60)).toContain(`${RESUME.host}/jeandv/cv-jean-rondon`)

    const channel = createContactChannel(CONTACT_MENU)
    const ctx = fakeContext({ width: 800, height: 600 })
    channel.enter?.(ctx)
    expect(channel.hits?.(ctx).map((rect) => rect.id)).toEqual([...LINKS.map((link) => link.id), 'cv'])
    expect(channel.hits?.(ctx).at(-1)?.label).toBe('OPEN CV')
    expect(channel.key?.(String(count), ctx)).toBe(true)
    expect(ctx.openLink).toHaveBeenLastCalledWith(RESUME.url)
    expect(channel.key?.(String(count + 1), ctx)).toBe(false)
    // Arrow up from the first row wraps to the CV; Enter opens it.
    channel.enter?.(ctx)
    channel.key?.('ArrowUp', ctx)
    channel.key?.('Enter', ctx)
    expect(ctx.openLink).toHaveBeenCalledTimes(2)
    channel.press?.('cv', ctx)
    expect(ctx.openLink).toHaveBeenCalledTimes(3)
    expect(ctx.openLink).toHaveBeenLastCalledWith(RESUME.url)
  })

  it('tape channel: Enter and the OPEN rect open the tape URL', () => {
    const tape = TAPES.find((item) => item.url !== undefined)
    if (!tape?.url) throw new Error('fixture needs a tape with a url')
    const channel = createTapeChannel(tape)
    const ctx = fakeContext()
    expect(channel.id).toBe(`tape/${tape.id}`)
    expect(channel.key?.('Enter', ctx)).toBe(true)
    expect(ctx.openLink).toHaveBeenCalledWith(tape.url)
    expect(channel.hits?.(ctx).map((rect) => rect.id)).toEqual(['open'])
    const noUrl: Tape = { ...tape, url: undefined }
    expect(createTapeChannel(noUrl).hits?.(ctx)).toEqual([])
    expect(createTapeChannel(noUrl).key?.('Enter', ctx)).toBe(false)
  })

  it('notepad: companies then projects, one hit rect per tape, arrows surf tapes', () => {
    const order = notepadOrder(TAPES)
    expect(order.map((tape) => tape.kind)).toEqual([...order].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'company' ? -1 : 1)).map((tape) => tape.kind))
    const rows = notepadRows(TAPES)
    expect(rows[0]).toEqual({ kind: 'heading', text: 'Companies' })
    expect(rows.filter((row) => row.kind === 'tape')).toHaveLength(TAPES.length)

    expect(adjacentTape(order, undefined, 1)?.id).toBe(order[0]?.id)
    expect(adjacentTape(order, undefined, -1)?.id).toBe(order.at(-1)?.id)
    expect(adjacentTape(order, order.at(-1)?.id, 1)?.id).toBe(order[0]?.id)

    const channel = createNotepadChannel(TAPES)
    const ctx = fakeContext({ width: 512, height: 832 })
    const hits = channel.hits?.(ctx) ?? []
    expect(hits.map((rect) => rect.id).sort()).toEqual(TAPES.map((tape) => tape.id).sort())
    for (const rect of hits) expect(rect.label).toMatch(/^PLAY /)
    expect(channel.key?.('Enter', ctx)).toBe(true)
    expect(ctx.navigate).toHaveBeenLastCalledWith(`#work/${order[0]?.id}`)
    channel.setActive(order[0]?.id)
    expect(channel.key?.('Enter', ctx)).toBe(false)
    expect(channel.key?.('ArrowDown', ctx)).toBe(true)
    expect(ctx.navigate).toHaveBeenLastCalledWith(`#work/${order[1]?.id}`)
    channel.press?.(TAPES[2]?.id ?? '', ctx)
    expect(ctx.navigate).toHaveBeenLastCalledWith(`#work/${TAPES[2]?.id}`)
  })

  it('polaroid initials', () => {
    expect(initialsOf('Jean Rondón')).toBe('JR')
    expect(initialsOf('  Ada  ')).toBe('A')
  })
})
