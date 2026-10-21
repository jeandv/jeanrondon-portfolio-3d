import type { DialPlan, DialTone } from '../../../audio/modem'

/**
 * The BBS dial-up on #online (plan §1 "Online: un BBS dial-up en la PC";
 * pure). A terminal program dials JEAN-NET, the line rings, the modems
 * handshake, CONNECT, the BBS banner and an auto-typed login; then the
 * contact menu. The full run plays once per session; later visits only flash
 * CONNECT; reduced motion and ?capture go straight to the menu.
 */

/** What the BBS shows (store + body[data-bbs]). */
export type BbsStatus = 'off' | 'dialing' | 'menu'

export const BBS_NAME = 'JEAN-NET BBS'
export const DIAL_NUMBER = '555-0199'
export const DIAL_DIGITS = DIAL_NUMBER.replace(/\D/g, '')
export const CONNECT_LINE = 'CONNECT 28800/ARQ/V34'

/** Seconds from the start of the full dial-up. */
export const DIAL_TIMING = {
  directory: 0.2,
  atdt: 0.42,
  atdtCps: 40,
  firstTone: 0.8,
  toneOn: 0.075,
  toneGap: 0.045,
  rings: [
    [1.62, 2.05],
    [2.25, 2.68],
  ],
  handshake: [2.86, 4.12],
  connect: 4.16,
  banner: 4.26,
  bannerStep: 0.035,
  login: 4.52,
  loginCps: 40,
  menu: 4.95,
} as const

/** The quick reconnect of later visits. */
export const QUICK_TIMING = { connect: 0.12, menu: 0.7 } as const

export type LineTone = 'dim' | 'normal' | 'hot'

export interface DialLine {
  /** Seconds from the start when the line appears. */
  readonly at: number
  readonly text: string
  readonly tone: LineTone
  /** Typed at this rate (chars/s) instead of appearing at once. */
  readonly cps?: number
}

export interface DialScript {
  readonly kind: 'full' | 'quick'
  readonly lines: readonly DialLine[]
  /** The menu replaces the dial-up at this time (s). */
  readonly total: number
  /** The modem sound (null: silent). */
  readonly plan: DialPlan | null
}

/** ASCII-only box (the terminal font's latin subset has no box-drawing glyphs). */
export function boxLines(rows: readonly string[], width: number): string[] {
  const inner = width - 4
  const edge = `+${'='.repeat(width - 2)}+`
  return [edge, ...rows.map((row) => `| ${row.slice(0, inner).padEnd(inner)} |`), edge]
}

/** The BBS welcome banner. */
export function bbsBanner(sysop: string): string[] {
  return boxLines(
    [
      `${BBS_NAME}  .  node 1 of 1  .  ANSI`,
      `sysop: ${sysop.toUpperCase()}`,
      '"a cozy desk at the end of the wire"',
    ],
    44,
  )
}

/** DTMF digit timings of the full dial-up. */
export function dialTones(digits = DIAL_DIGITS): DialTone[] {
  const { firstTone, toneOn, toneGap } = DIAL_TIMING
  return [...digits].map((key, i) => {
    const start = firstTone + i * (toneOn + toneGap)
    return { key, start, end: start + toneOn }
  })
}

export function dialPlan(): DialPlan {
  return { tones: dialTones(), rings: DIAL_TIMING.rings, handshake: DIAL_TIMING.handshake }
}

export function fullDialScript(sysop: string): DialScript {
  const t = DIAL_TIMING
  const banner = bbsBanner(sysop).map(
    (text, i): DialLine => ({ at: t.banner + i * t.bannerStep, text, tone: i === 0 || i === 4 ? 'normal' : 'hot' }),
  )
  return {
    kind: 'full',
    lines: [
      { at: 0, text: 'TERM 2.1  Copyright (C) 1994, also Nobody in Particular', tone: 'dim' },
      { at: t.directory, text: `Dialing directory entry 1 of 1: ${BBS_NAME}, ${DIAL_NUMBER}`, tone: 'normal' },
      { at: t.atdt, text: `ATDT ${DIAL_DIGITS}`, tone: 'normal', cps: t.atdtCps },
      ...t.rings.map(([start]): DialLine => ({ at: start, text: 'RING...', tone: 'dim' })),
      { at: t.connect, text: CONNECT_LINE, tone: 'hot' },
      ...banner,
      { at: t.login, text: 'login: guest', tone: 'normal', cps: t.loginCps },
    ],
    total: t.menu,
    plan: dialPlan(),
  }
}

export function quickDialScript(): DialScript {
  return {
    kind: 'quick',
    lines: [
      { at: 0, text: `ATDT ${DIAL_DIGITS}`, tone: 'dim' },
      { at: QUICK_TIMING.connect, text: CONNECT_LINE, tone: 'hot' },
    ],
    total: QUICK_TIMING.menu,
    plan: null,
  }
}

/** Full the first time this session, a quick reconnect later, nothing with `instant` (reduced motion, ?capture). */
export function pickDialScript(instant: boolean, dialedBefore: boolean, sysop: string): DialScript | null {
  if (instant) return null
  return dialedBefore ? quickDialScript() : fullDialScript(sysop)
}

export interface DialRow {
  readonly text: string
  readonly tone: LineTone
}

export interface DialFrame {
  /** Screen rows (blank lines kept between groups). */
  readonly rows: readonly DialRow[]
  /** Block cursor (row, column), after the text being typed or below the last row. */
  readonly cursor: { readonly row: number; readonly col: number }
  /** The menu is due. */
  readonly done: boolean
}

/** Group breaks: a blank row before these line texts. */
const BLANK_BEFORE = new Set(['ATDT', 'CONNECT', '+==', 'login:'])

function needsBlank(text: string, previous: DialLine | undefined): boolean {
  if (!previous) return false
  const head = text.startsWith('+==') ? '+==' : (text.split(' ')[0] ?? '')
  if (head === '+==' && previous.text.startsWith('|')) return false
  return BLANK_BEFORE.has(head)
}

/** What the terminal shows `t` seconds into a script. */
export function dialFrame(script: DialScript, t: number): DialFrame {
  const rows: DialRow[] = []
  let cursor = { row: 0, col: 0 }
  let previous: DialLine | undefined
  for (const line of script.lines) {
    if (line.at > t) break
    if (needsBlank(line.text, previous)) rows.push({ text: '', tone: 'normal' })
    const shown = line.cps === undefined ? line.text.length : Math.min(line.text.length, Math.floor((t - line.at) * line.cps))
    rows.push({ text: line.text.slice(0, shown), tone: line.tone })
    // While a line types, the cursor follows it; otherwise it waits on the next row.
    cursor = shown < line.text.length ? { row: rows.length - 1, col: shown } : { row: rows.length, col: 0 }
    previous = line
  }
  return { rows, cursor, done: t >= script.total }
}

/** The bottom status bar, like the reference's terminal. */
export function dialStatus(status: Exclude<BbsStatus, 'off'>, onlineSeconds = 0): string {
  const head = 'TERM 2.1 | 28800 8N1 | ANSI-BBS'
  if (status === 'dialing') return `${head} | Dialing ${DIAL_NUMBER} | Any key skips`
  const s = Math.max(0, Math.floor(onlineSeconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${head} | Online ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)} | ESC hangs up`
}
