import type { Profile } from '../../../content/types'
import type { Channel, ChannelContext } from '../../channel'
import { blinkOn } from '../../draw'
import type { HitRect } from '../../hit'
import { isAtEnd, pageDown, pagerStatus, pageUp, scrollBy, typedLengths } from '../../pager'
import { monoMeasure, wrapText } from '../../text'
import {
  blockCursor,
  charWidth,
  clearTerm,
  PC_BG,
  PC_MARGIN,
  PHOSPHOR,
  PHOSPHOR_HOT,
  TERM_LINE,
  TERM_TOP,
  termFont,
  termLine,
} from './term'

/** Typewriter speed (plan §5.5). */
export const TYPE_CPS = 60
const STATUS_H = 36
const STATUS_GAP = 20

/** About text as paragraphs ('' = blank line), straight from the profile. */
export function aboutParagraphs(profile: Profile): string[] {
  const bio = profile.bio.flatMap((paragraph, i) => (i === 0 ? [paragraph] : ['', paragraph]))
  return [
    'C:\\> TYPE ABOUT.TXT',
    '',
    `NAME      ${profile.name.toUpperCase()}`,
    `ROLE      ${profile.role}`,
    `LOCATION  ${profile.location}`,
    '',
    ...bio,
    '',
    'C:\\>',
  ]
}

/** Wraps paragraphs to `cols` monospace columns (lines that fit keep their spacing). */
export function pagerLines(paragraphs: readonly string[], cols: number): string[] {
  const measure = monoMeasure(1)
  return paragraphs.flatMap((paragraph) => (paragraph.length <= cols ? [paragraph] : wrapText(paragraph, cols, measure)))
}

function statusTop(height: number): number {
  return height - PC_MARGIN - STATUS_H + 8
}

/** Visible rows for a screen height (the status bar sits at the bottom). */
export function pagerRows(height: number): number {
  return Math.max(1, Math.floor((statusTop(height) - STATUS_GAP - TERM_TOP) / TERM_LINE) + 1)
}

function statusRect(width: number, height: number, label: string): HitRect {
  return { id: 'more', x: PC_MARGIN - 10, y: statusTop(height), w: width - PC_MARGIN * 2 + 20, h: STATUS_H, label }
}

/** Green phosphor pager: bio typed at 60 chars/s, `-- MORE (45%) --`, Space/PageDown/arrows. */
export function createAboutChannel(profile: Profile): Channel {
  const paragraphs = aboutParagraphs(profile)
  let lines: string[] | null = null
  let rows = 1
  let top = 0
  /** First line still being typed (Infinity = everything visible is complete). */
  let typeFrom = 0
  let typeStart = 0
  let typing = true

  const revealedAt = (ctx: ChannelContext) =>
    ctx.reducedMotion ? Number.POSITIVE_INFINITY : Math.floor((ctx.time - typeStart) * TYPE_CPS)

  const typingDone = (ctx: ChannelContext): boolean => {
    if (!lines) return true
    const shown = typedLengths(lines, top, rows, typeFrom, revealedAt(ctx))
    return shown.every((length, i) => length >= (lines?.[top + i]?.length ?? 0))
  }

  const nextPage = (ctx: ChannelContext): void => {
    if (!lines) return
    if (!typingDone(ctx)) {
      typeFrom = Number.POSITIVE_INFINITY
      return
    }
    const next = pageDown(top, lines.length, rows)
    typeFrom = next === 0 ? 0 : top + rows
    top = next
    typeStart = ctx.time
  }

  return {
    id: 'about',
    get fps() {
      return typing ? 30 : 2
    },
    enter(ctx) {
      top = 0
      typeFrom = 0
      typeStart = ctx.time
      typing = true
    },
    draw(g, t, ctx) {
      const { width, height } = ctx
      if (!lines) {
        const cols = Math.max(20, Math.floor((width - PC_MARGIN * 2) / charWidth(g)))
        lines = pagerLines(paragraphs, cols)
        rows = pagerRows(height)
      }
      clearTerm(g, width, height)

      const shown = typedLengths(lines, top, rows, typeFrom, revealedAt(ctx))
      typing = false
      shown.forEach((length, i) => {
        const line = lines?.[top + i] ?? ''
        termLine(g, line.slice(0, length), i)
        if (!typing && length < line.length) {
          typing = true
          blockCursor(g, length, i, charWidth(g))
        }
      })
      // Trailing blank lines still cost typing time.
      if (!typing && !typingDone(ctx)) typing = true

      const status = isAtEnd(top, lines.length, rows) ? 'BACK TO TOP' : 'NEXT PAGE'
      const rect = statusRect(width, height, status)
      const hot = ctx.hover === rect.id
      g.fillStyle = hot ? PHOSPHOR_HOT : PHOSPHOR
      g.fillRect(rect.x, rect.y, rect.w, rect.h)
      g.font = termFont(700)
      g.fillStyle = PC_BG
      g.textAlign = 'left'
      const baseline = rect.y + rect.h - 10
      const label = pagerStatus(top, lines.length, rows)
      g.fillText(label, rect.x + 10, baseline)
      if (!typing && blinkOn(t, 1) && !ctx.reducedMotion) {
        g.fillRect(rect.x + 14 + g.measureText(label).width, rect.y + 7, 10, rect.h - 14)
      }
      g.font = termFont(400, 18)
      g.textAlign = 'right'
      g.fillText('SPACE NEXT  PGUP BACK  ARROWS SCROLL', rect.x + rect.w - 10, baseline)
    },
    key(key, ctx) {
      if (!lines) return false
      switch (key) {
        case ' ':
        case 'PageDown':
          nextPage(ctx)
          return true
        case 'PageUp':
          top = pageUp(top, lines.length, rows)
          typeFrom = Number.POSITIVE_INFINITY
          return true
        case 'ArrowDown':
        case 'Enter':
          top = scrollBy(top, 1, lines.length, rows)
          typeFrom = Number.POSITIVE_INFINITY
          return true
        case 'ArrowUp':
          top = scrollBy(top, -1, lines.length, rows)
          typeFrom = Number.POSITIVE_INFINITY
          return true
        default:
          return false
      }
    },
    hits({ width, height }) {
      if (!lines) return []
      return [statusRect(width, height, isAtEnd(top, lines.length, rows) ? 'BACK TO TOP' : 'NEXT PAGE')]
    },
    press(id, ctx) {
      if (id === 'more') nextPage(ctx)
    },
  }
}
