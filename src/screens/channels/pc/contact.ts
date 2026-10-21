import type { DialPlan } from '../../../audio/modem'
import type { MenuLink } from '../../../content/contactMenu'
import { displayHref } from '../../../content/links'
import type { Channel, ChannelContext } from '../../channel'
import { blinkOn } from '../../draw'
import { font, FONT } from '../../fonts'
import type { HitRect } from '../../hit'
import { ellipsize, fitSize, monoMeasure } from '../../text'
import { CONNECT_LINE, dialFrame, dialStatus, type BbsStatus, type DialScript, type LineTone } from './dialup'
import {
  blockCursor,
  charWidth,
  clearTerm,
  PC_BG,
  PC_MARGIN,
  PHOSPHOR,
  PHOSPHOR_DIM,
  PHOSPHOR_HOT,
  TERM_LINE,
  TERM_SIZE,
  TERM_TOP,
  termLine,
} from './term'

const FIRST_LINK_ROW = 5
const LABEL_COLS = 10

/** The dial-up terminal is denser than the menu (an 80-column program). */
const DIAL_SIZE = 20
const DIAL_LINE = 26
const DIAL_TOP = PC_MARGIN + DIAL_SIZE
/** Bottom status bar (TERM 2.1 | 28800 8N1 | …). */
const STATUS_H = 30
const STATUS_MAX_SIZE = 16

/** Menu row text: `[1] EMAIL      jeanrdev@gmail.com` (the last row is the CV). */
export function contactRow(link: MenuLink, index: number, cols: number): string {
  const text = `[${index + 1}] ${link.label.toUpperCase().padEnd(LABEL_COLS)} ${displayHref(link.href)}`
  return ellipsize(text, cols, monoMeasure(1))
}

function rowRect(link: MenuLink, index: number, width: number): HitRect {
  const baseline = TERM_TOP + (FIRST_LINK_ROW + index) * TERM_LINE
  return {
    id: link.id,
    x: PC_MARGIN - 10,
    y: baseline - TERM_SIZE,
    w: width - PC_MARGIN * 2 + 20,
    h: TERM_LINE,
    label: `OPEN ${link.label.toUpperCase()}`,
  }
}

/** The BBS around the menu: which dial-up to play, its sound, and where its status goes. */
export interface BbsHooks {
  /** Called on enter: the dial-up to play (null: straight to the menu). */
  script(): DialScript | null
  /** Starts the modem sound; returns its stop. */
  startSound(plan: DialPlan): () => void
  onStatus(status: BbsStatus): void
}

const TONE_COLOR: Readonly<Record<LineTone, string>> = { dim: PHOSPHOR_DIM, normal: PHOSPHOR, hot: PHOSPHOR_HOT }

function dialText(g: CanvasRenderingContext2D, text: string, row: number, color: string): void {
  g.font = font(400, DIAL_SIZE, FONT.mono)
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = color
  g.fillText(text, PC_MARGIN, DIAL_TOP + row * DIAL_LINE)
}

/** Inverse status bar along the bottom; the text shrinks to fit. */
function statusBar(g: CanvasRenderingContext2D, text: string, width: number, height: number): void {
  const x = PC_MARGIN - 10
  const y = height - PC_MARGIN - STATUS_H + 8
  const w = width - PC_MARGIN * 2 + 20
  g.fillStyle = PHOSPHOR_DIM
  g.fillRect(x, y, w, STATUS_H)
  const size = fitSize(w - 20, STATUS_MAX_SIZE, 11, (s) => {
    g.font = font(700, s, FONT.mono)
    return g.measureText(text).width
  })
  g.font = font(700, size, FONT.mono)
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = PC_BG
  g.fillText(text, x + 10, y + STATUS_H - 10)
}

const skipRect = (width: number, height: number): HitRect => ({ id: 'skip', x: 0, y: 0, w: width, h: height, label: 'SKIP' })

/**
 * BBS contact menu: arrows/Enter, number keys or a click open the link. With
 * `bbs`, entering plays the dial-up first (any key or a click skips it) and a
 * status bar runs along the bottom; leaving cuts its sound.
 */
export function createContactChannel(links: readonly MenuLink[], bbs?: BbsHooks): Channel {
  let selected = 0
  let script: DialScript | null = null
  let dialing = false
  let connectedAt = 0
  let stopSound: (() => void) | null = null

  const open = (index: number, ctx: ChannelContext): void => {
    const link = links[index]
    if (!link) return
    selected = index
    ctx.openLink(link.href)
  }

  const cutSound = (): void => {
    stopSound?.()
    stopSound = null
  }

  const toMenu = (ctx: ChannelContext): void => {
    dialing = false
    connectedAt = ctx.time
    cutSound()
    bbs?.onStatus('menu')
    ctx.invalidate()
  }

  const drawDial = (g: CanvasRenderingContext2D, dial: DialScript, t: number, ctx: ChannelContext): void => {
    const frame = dialFrame(dial, t)
    frame.rows.forEach((row, i) => dialText(g, row.text, i, TONE_COLOR[row.tone]))
    if (ctx.reducedMotion || blinkOn(t, 2)) {
      g.font = font(400, DIAL_SIZE, FONT.mono)
      const cw = g.measureText('M').width
      g.fillStyle = PHOSPHOR
      g.fillRect(PC_MARGIN + frame.cursor.col * cw, DIAL_TOP + frame.cursor.row * DIAL_LINE - DIAL_SIZE + 3, Math.ceil(cw), DIAL_SIZE + 2)
    }
    statusBar(g, dialStatus('dialing'), ctx.width, ctx.height)
  }

  return {
    id: 'contact',
    get fps() {
      return dialing ? 30 : 2
    },
    enter(ctx) {
      selected = 0
      cutSound()
      script = bbs?.script() ?? null
      dialing = script !== null
      connectedAt = ctx.time
      if (script?.plan && bbs) stopSound = bbs.startSound(script.plan)
      bbs?.onStatus(dialing ? 'dialing' : 'menu')
    },
    exit() {
      cutSound()
      dialing = false
      bbs?.onStatus('off')
    },
    draw(g, t, ctx) {
      const { width, height, hover, reducedMotion } = ctx
      clearTerm(g, width, height)
      if (dialing && script) {
        if (t < script.total) {
          drawDial(g, script, t, ctx)
          return
        }
        toMenu(ctx)
      }

      const cw = charWidth(g)
      const cols = Math.floor((width - PC_MARGIN * 2) / cw)
      termLine(g, 'C:\\> DIAL JEAN-NET', 0, PHOSPHOR_DIM)
      termLine(g, CONNECT_LINE, 1, PHOSPHOR_DIM)
      termLine(g, '*** JEAN-NET BBS :: CONTACT ***', 3)

      const hovered = links.findIndex((link) => link.id === hover)
      const active = hovered >= 0 ? hovered : selected
      links.forEach((link, i) => {
        const row = FIRST_LINK_ROW + i
        const text = contactRow(link, i, cols)
        if (i === active) {
          const rect = rowRect(link, i, width)
          g.fillStyle = PHOSPHOR
          g.fillRect(rect.x, rect.y, rect.w, rect.h)
          termLine(g, text, row, PC_BG)
        } else {
          termLine(g, text, row)
        }
      })

      const help = FIRST_LINK_ROW + links.length + 1
      const keys = links.length > 1 ? `1-${links.length}` : '1'
      termLine(g, ellipsize(`UP/DN SELECT  ENTER OPEN  ${keys} DIRECT`, cols, monoMeasure(1)), help, PHOSPHOR_DIM)
      termLine(g, 'C:\\>', help + 2)
      if (reducedMotion || blinkOn(t, 1)) blockCursor(g, 4, help + 2, cw)
      if (bbs) statusBar(g, dialStatus('menu', t - connectedAt), width, height)
    },
    key(key, ctx) {
      // Any key skips the dial-up.
      if (dialing) {
        toMenu(ctx)
        return true
      }
      const count = links.length
      if (count === 0) return false
      switch (key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          selected = (selected - 1 + count) % count
          return true
        case 'ArrowDown':
        case 'ArrowRight':
          selected = (selected + 1) % count
          return true
        case 'Enter':
        case ' ':
          open(selected, ctx)
          return true
        default: {
          const digit = /^[1-9]$/.test(key) ? Number(key) - 1 : -1
          if (digit < 0 || digit >= count) return false
          open(digit, ctx)
          return true
        }
      }
    },
    hits({ width, height }) {
      if (dialing) return [skipRect(width, height)]
      return links.map((link, i) => rowRect(link, i, width))
    },
    press(id, ctx) {
      if (id === 'skip') {
        if (dialing) toMenu(ctx)
        return
      }
      open(
        links.findIndex((link) => link.id === id),
        ctx,
      )
    },
  }
}
