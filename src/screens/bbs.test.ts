import { describe, expect, it, vi } from 'vitest'
import { LINKS } from '../content/links'
import { PROFILE } from '../content/profile'
import type { ChannelContext } from './channel'
import { createContactChannel, type BbsHooks } from './channels/pc/contact'
import {
  bbsBanner,
  BBS_NAME,
  boxLines,
  CONNECT_LINE,
  DIAL_DIGITS,
  DIAL_TIMING,
  dialFrame,
  dialStatus,
  dialTones,
  fullDialScript,
  pickDialScript,
  QUICK_TIMING,
  quickDialScript,
  type BbsStatus,
  type DialScript,
} from './channels/pc/dialup'
import { isCanvasSafe } from './text'

function fakeContext(overrides: Partial<ChannelContext> = {}): ChannelContext {
  return {
    width: 800,
    height: 600,
    reducedMotion: false,
    hover: null,
    time: 0,
    invalidate: vi.fn(),
    navigate: vi.fn(),
    openLink: vi.fn(),
    ...overrides,
  }
}

/** A stand-in 2D context: the channel only needs fills, text and measuring. */
function fakeGraphics(): CanvasRenderingContext2D {
  const g = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 12 }),
  }
  return g as unknown as CanvasRenderingContext2D
}

interface Recorder {
  readonly hooks: BbsHooks
  readonly statuses: BbsStatus[]
  readonly stop: ReturnType<typeof vi.fn>
  readonly startSound: ReturnType<typeof vi.fn>
}

function recorder(script: DialScript | null): Recorder {
  const statuses: BbsStatus[] = []
  const stop = vi.fn()
  const startSound = vi.fn(() => stop)
  return {
    statuses,
    stop,
    startSound,
    hooks: { script: () => script, startSound, onStatus: (status) => statuses.push(status) },
  }
}

describe('BBS dial-up script', () => {
  const script = fullDialScript(PROFILE.name)

  it('runs about 4–5 s: dial, two rings, the handshake, CONNECT, banner and login before the menu', () => {
    expect(script.total).toBeGreaterThanOrEqual(4)
    expect(script.total).toBeLessThanOrEqual(5)
    const at = (text: string) => script.lines.find((line) => line.text.startsWith(text))?.at ?? Number.NaN
    expect(at('TERM 2.1')).toBe(0)
    expect(at('Dialing directory entry 1 of 1')).toBeLessThan(at('ATDT'))
    const tones = dialTones()
    expect(tones.map((tone) => tone.key).join('')).toBe(DIAL_DIGITS)
    expect(tones[0]?.start).toBeGreaterThan(at('ATDT'))
    // Rings follow the last digit; CONNECT follows the handshake; login comes last.
    const [ring1, ring2] = DIAL_TIMING.rings
    expect(ring1[0]).toBeGreaterThan(tones.at(-1)?.end ?? Number.POSITIVE_INFINITY)
    expect(ring2[0]).toBeGreaterThan(ring1[1])
    expect(DIAL_TIMING.handshake[0]).toBeGreaterThan(ring2[1])
    expect(DIAL_TIMING.handshake[1] - DIAL_TIMING.handshake[0]).toBeGreaterThan(1)
    expect(at(CONNECT_LINE)).toBeGreaterThanOrEqual(DIAL_TIMING.handshake[1])
    expect(at('login:')).toBeGreaterThan(at(CONNECT_LINE))
    expect(script.total).toBeGreaterThan(at('login:') + 'login: guest'.length / DIAL_TIMING.loginCps)
    // Lines come in time order.
    const times = script.lines.map((line) => line.at)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(script.plan?.tones).toHaveLength(DIAL_DIGITS.length)
  })

  it('reveals lines over time, types ATDT and the login, and is done at the end', () => {
    expect(dialFrame(script, 0).rows.map((row) => row.text)).toEqual([script.lines[0]?.text])
    const typing = dialFrame(script, DIAL_TIMING.atdt + 0.1)
    const atdt = typing.rows.at(-1)
    expect(atdt?.text).toBe(`ATDT ${DIAL_DIGITS}`.slice(0, Math.floor(0.1 * DIAL_TIMING.atdtCps)))
    expect(typing.cursor).toEqual({ row: typing.rows.length - 1, col: atdt?.text.length })
    // A blank row separates the dialing directory from the modem command.
    expect(typing.rows.at(-2)?.text).toBe('')

    const ringing = dialFrame(script, DIAL_TIMING.rings[1][0] + 0.01)
    expect(ringing.rows.filter((row) => row.text === 'RING...')).toHaveLength(2)
    expect(ringing.cursor).toEqual({ row: ringing.rows.length, col: 0 })
    expect(ringing.done).toBe(false)

    const end = dialFrame(script, script.total)
    expect(end.done).toBe(true)
    expect(end.rows.map((row) => row.text)).toContain(CONNECT_LINE)
    expect(end.rows.at(-1)?.text).toBe('login: guest')
  })

  it('draws the banner as an ASCII box in the terminal font', () => {
    const banner = bbsBanner(PROFILE.name)
    expect(banner[0]).toMatch(/^\+=+\+$/)
    expect(banner.at(-1)).toBe(banner[0])
    expect(new Set(banner.map((line) => line.length)).size).toBe(1)
    expect(banner.some((line) => line.includes(BBS_NAME))).toBe(true)
    expect(boxLines(['x'.repeat(80)], 20).every((line) => line.length === 20)).toBe(true)
    for (const line of [...fullDialScript(PROFILE.name).lines, ...quickDialScript().lines]) {
      expect(isCanvasSafe(line.text), line.text).toBe(true)
    }
    expect(isCanvasSafe(dialStatus('dialing'))).toBe(true)
    expect(isCanvasSafe('╔═╗')).toBe(false)
  })

  it('has the reference status bar', () => {
    expect(dialStatus('dialing')).toBe('TERM 2.1 | 28800 8N1 | ANSI-BBS | Dialing 555-0199 | Any key skips')
    expect(dialStatus('menu', 3725)).toBe('TERM 2.1 | 28800 8N1 | ANSI-BBS | Online 01:02:05 | ESC hangs up')
  })

  it('plays in full once per session, then a quick CONNECT; never with reduced motion / capture', () => {
    expect(pickDialScript(false, false, PROFILE.name)?.kind).toBe('full')
    const quick = pickDialScript(false, true, PROFILE.name)
    expect(quick?.kind).toBe('quick')
    expect(quick?.total).toBe(QUICK_TIMING.menu)
    expect(quick?.plan).toBeNull()
    expect(quick?.lines.some((line) => line.text === CONNECT_LINE)).toBe(true)
    expect(pickDialScript(true, false, PROFILE.name)).toBeNull()
    expect(pickDialScript(true, true, PROFILE.name)).toBeNull()
  })
})

describe('BBS contact channel', () => {
  it('dials on enter: status + modem sound; any key skips to the menu and cuts the sound', () => {
    const script = fullDialScript(PROFILE.name)
    const bbs = recorder(script)
    const channel = createContactChannel(LINKS, bbs.hooks)
    const ctx = fakeContext()
    channel.enter?.(ctx)
    expect(bbs.statuses).toEqual(['dialing'])
    expect(bbs.startSound).toHaveBeenCalledWith(script.plan)
    expect(channel.fps).toBe(30)
    // While dialing the whole screen is one SKIP rect and any key is taken.
    expect(channel.hits?.(ctx).map((rect) => rect.id)).toEqual(['skip'])
    expect(channel.key?.('x', ctx)).toBe(true)
    expect(bbs.stop).toHaveBeenCalledTimes(1)
    expect(bbs.statuses).toEqual(['dialing', 'menu'])
    expect(channel.fps).toBe(2)
    // Back to the normal menu: keys select and open links.
    expect(channel.hits?.(ctx).map((rect) => rect.id)).toEqual(LINKS.map((link) => link.id))
    expect(channel.key?.('1', ctx)).toBe(true)
    expect(ctx.openLink).toHaveBeenCalledWith(LINKS[0]?.href)
  })

  it('a click on the screen skips too', () => {
    const bbs = recorder(fullDialScript(PROFILE.name))
    const channel = createContactChannel(LINKS, bbs.hooks)
    const ctx = fakeContext()
    channel.enter?.(ctx)
    channel.press?.('skip', ctx)
    expect(bbs.statuses.at(-1)).toBe('menu')
    expect(bbs.stop).toHaveBeenCalled()
    expect(ctx.openLink).not.toHaveBeenCalled()
  })

  it('reaches the menu on its own when the script ends', () => {
    const script = fullDialScript(PROFILE.name)
    const bbs = recorder(script)
    const channel = createContactChannel(LINKS, bbs.hooks)
    const g = fakeGraphics()
    channel.enter?.(fakeContext())
    channel.draw(g, 1, fakeContext({ time: 1 }))
    expect(bbs.statuses.at(-1)).toBe('dialing')
    channel.draw(g, script.total + 0.01, fakeContext({ time: script.total + 0.01 }))
    expect(bbs.statuses.at(-1)).toBe('menu')
    expect(bbs.stop).toHaveBeenCalledTimes(1)
  })

  it('leaving mid-dial cuts the sound and reports off', () => {
    const bbs = recorder(fullDialScript(PROFILE.name))
    const channel = createContactChannel(LINKS, bbs.hooks)
    channel.enter?.(fakeContext())
    channel.exit?.()
    expect(bbs.stop).toHaveBeenCalledTimes(1)
    expect(bbs.statuses.at(-1)).toBe('off')
    // Idempotent: a second exit does not stop twice.
    channel.exit?.()
    expect(bbs.stop).toHaveBeenCalledTimes(1)
  })

  it('goes straight to the menu without a script (reduced motion, ?capture), silently', () => {
    const bbs = recorder(null)
    const channel = createContactChannel(LINKS, bbs.hooks)
    const ctx = fakeContext()
    channel.enter?.(ctx)
    expect(bbs.statuses).toEqual(['menu'])
    expect(bbs.startSound).not.toHaveBeenCalled()
    expect(channel.key?.('x', ctx)).toBe(false)
  })

  it('the quick reconnect plays no modem sound', () => {
    const bbs = recorder(quickDialScript())
    const channel = createContactChannel(LINKS, bbs.hooks)
    channel.enter?.(fakeContext())
    expect(bbs.statuses).toEqual(['dialing'])
    expect(bbs.startSound).not.toHaveBeenCalled()
  })
})
