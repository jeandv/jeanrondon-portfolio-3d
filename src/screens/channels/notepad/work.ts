import type { Tape } from '../../../content/types'
import type { Channel, ChannelContext } from '../../channel'
import { font, FONT } from '../../fonts'
import type { HitRect } from '../../hit'
import { slotKeys } from '../../keys'
import { canvasMeasure, ellipsize, fitSize } from '../../text'

/* Yellow legal pad (plan §5.5): paper, blue rules, red margin, Caveat 600. */
const PAPER = '#fdf3a7'
const RULE_COLOR = '#9cc3e6'
const MARGIN_COLOR = '#e2665f'
const INK = '#1f2c6e'
const INK_SOFT = '#4b5a8a'
const PENCIL = '#8a857a'
const RED_PEN = '#c8312b'

const MARGIN_X = 62
const TEXT_X = 82
const RIGHT_PAD = 24
const FIRST_RULE = 172
const RULE = 44
const CIRCLE_SECONDS = 0.45

export type NotepadRow =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'tape'; readonly tape: Tape }
  | { readonly kind: 'blank' }

/** Companies first, then projects (content order inside each group). */
export function notepadOrder(tapes: readonly Tape[]): Tape[] {
  return [...tapes.filter((tape) => tape.kind === 'company'), ...tapes.filter((tape) => tape.kind === 'project')]
}

/** One row per ruled line: "Companies", its tapes, a gap, "Projects", its tapes. */
export function notepadRows(tapes: readonly Tape[]): NotepadRow[] {
  const rows: NotepadRow[] = []
  const groups: readonly [string, Tape[]][] = [
    ['Companies', tapes.filter((tape) => tape.kind === 'company')],
    ['Projects', tapes.filter((tape) => tape.kind === 'project')],
  ]
  for (const [heading, group] of groups) {
    if (group.length === 0) continue
    if (rows.length > 0) rows.push({ kind: 'blank' })
    rows.push({ kind: 'heading', text: heading })
    for (const tape of group) rows.push({ kind: 'tape', tape })
  }
  return rows
}

/** Next/previous tape in notepad order (wraps); from nothing, step into the list. */
export function adjacentTape(order: readonly Tape[], current: string | undefined, step: 1 | -1): Tape | undefined {
  if (order.length === 0) return undefined
  const index = order.findIndex((tape) => tape.id === current)
  if (index < 0) return step > 0 ? order[0] : order[order.length - 1]
  return order[(index + step + order.length) % order.length]
}

/** y of the ruled line row `i` sits on. */
function ruleY(row: number): number {
  return FIRST_RULE + row * RULE
}

/** Stable 0..1 seed per tape so each circle has its own wobble. */
function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** Hand-drawn ellipse (slightly spiralling, overlapping its start), drawn up to `progress`. */
function handCircle(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  progress: number,
  seed: number,
): void {
  const sweep = Math.PI * 2 * 1.12 * progress
  const start = -2.5 + seed
  const steps = 72
  g.beginPath()
  for (let i = 0; i <= steps; i++) {
    const a = (sweep * i) / steps
    const wobble = 1 + 0.04 * Math.sin(3 * a + seed * 7) + 0.02 * Math.sin(5 * a + seed * 3) + a * 0.012
    const x = cx + Math.cos(start + a) * rx * wobble
    const y = cy + Math.sin(start + a) * ry * wobble
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.strokeStyle = RED_PEN
  g.lineWidth = 3.5
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.stroke()
}

function drawPaper(g: CanvasRenderingContext2D, width: number, height: number): void {
  g.fillStyle = PAPER
  g.fillRect(0, 0, width, height)
  const shade = g.createLinearGradient(0, 0, 0, height)
  shade.addColorStop(0, 'rgba(120, 90, 0, 0.00)')
  shade.addColorStop(1, 'rgba(120, 90, 0, 0.07)')
  g.fillStyle = shade
  g.fillRect(0, 0, width, height)
  // Glue edge under the binding.
  g.fillStyle = 'rgba(150, 120, 20, 0.18)'
  g.fillRect(0, 0, width, 10)

  g.strokeStyle = RULE_COLOR
  g.lineWidth = 2
  g.beginPath()
  for (const y of [118, 123]) {
    g.moveTo(0, y)
    g.lineTo(width, y)
  }
  for (let y = FIRST_RULE; y < height - 8; y += RULE) {
    g.moveTo(0, y)
    g.lineTo(width, y)
  }
  g.stroke()

  g.strokeStyle = MARGIN_COLOR
  g.beginPath()
  for (const x of [MARGIN_X - 4, MARGIN_X]) {
    g.moveTo(x, 0)
    g.lineTo(x, height)
  }
  g.stroke()
}

function rowRect(tape: Tape, row: number, width: number): HitRect {
  return { id: tape.id, x: 12, y: ruleY(row) - RULE + 4, w: width - 24, h: RULE, label: `PLAY ${tape.title.toUpperCase()}` }
}

export interface NotepadChannel extends Channel {
  /** Circles the playing tape (undefined = none). */
  setActive(tapeId: string | undefined): void
}

/** The work list on the notepad page: every line plays its tape; the playing one is circled. */
export function createNotepadChannel(tapes: readonly Tape[]): NotepadChannel {
  const rows = notepadRows(tapes)
  const order = notepadOrder(tapes)
  let active: string | undefined
  let circlePending = false
  let circleStart = 0
  let circling = false

  const play = (tape: Tape | undefined, ctx: ChannelContext): boolean => {
    if (!tape) return false
    ctx.navigate(`#work/${tape.id}`)
    return true
  }

  return {
    id: 'work',
    get fps() {
      return circling ? 30 : 0
    },
    setActive(tapeId) {
      if (tapeId === active) return
      active = tapeId
      circlePending = tapeId !== undefined
    },
    draw(g, t, { width, height, hover, reducedMotion }) {
      if (circlePending) {
        circleStart = t
        circlePending = false
      }
      drawPaper(g, width, height)
      g.textAlign = 'left'
      g.textBaseline = 'alphabetic'

      g.font = font(600, 66, FONT.hand)
      g.fillStyle = INK
      g.fillText('Work', TEXT_X, 100)
      g.font = font(600, 28, FONT.hand)
      g.fillStyle = PENCIL
      g.textAlign = 'right'
      g.fillText('tapes on the shelf', width - RIGHT_PAD, 100)
      g.textAlign = 'left'

      const maxRight = width - RIGHT_PAD
      circling = false
      rows.forEach((row, i) => {
        const baseline = ruleY(i) - 9
        if (row.kind === 'blank') return
        if (row.kind === 'heading') {
          g.font = font(600, 40, FONT.hand)
          g.fillStyle = INK
          g.fillText(row.text, TEXT_X, baseline)
          const w = g.measureText(row.text).width
          g.strokeStyle = INK
          g.lineWidth = 2
          g.beginPath()
          g.moveTo(TEXT_X - 2, baseline + 5)
          g.quadraticCurveTo(TEXT_X + w / 2, baseline + 8, TEXT_X + w + 6, baseline + 4)
          g.stroke()
          return
        }

        const { tape } = row
        g.font = font(600, 28, FONT.hand)
        g.fillStyle = PENCIL
        g.textAlign = 'center'
        g.fillText(String(tape.slot), MARGIN_X / 2 - 2, baseline)

        g.font = font(600, 28, FONT.hand)
        g.textAlign = 'right'
        g.fillStyle = INK_SOFT
        g.fillText(tape.years, maxRight, baseline)
        const yearsW = g.measureText(tape.years).width
        g.textAlign = 'left'

        const titleMax = maxRight - yearsW - 20 - TEXT_X
        const size = fitSize(titleMax, 38, 22, (s) => {
          g.font = font(600, s, FONT.hand)
          return g.measureText(tape.title).width
        })
        g.font = font(600, size, FONT.hand)
        // Still too long at the smallest size: ellipsize.
        const title = ellipsize(tape.title, titleMax, canvasMeasure(g))
        const titleW = g.measureText(title).width

        if (hover === tape.id) {
          g.fillStyle = 'rgba(255, 160, 40, 0.32)'
          g.fillRect(TEXT_X - 6, baseline - size * 0.62, titleW + 12, size * 0.72)
        }
        g.fillStyle = INK
        g.fillText(title, TEXT_X, baseline)

        if (tape.id === active) {
          const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (t - circleStart) / CIRCLE_SECONDS))
          if (progress < 1) circling = true
          const eased = 1 - (1 - progress) ** 3
          handCircle(g, TEXT_X + titleW / 2, baseline - size * 0.28, titleW / 2 + 18, size * 0.62, eased, seedOf(tape.id))
        }
      })

      g.font = font(600, 26, FONT.hand)
      g.fillStyle = PENCIL
      g.fillText(`tap a line or press ${slotKeys(tapes.map((tape) => tape.slot))}`, TEXT_X, ruleY(rows.length + 1) - 9)
    },
    key(key, ctx) {
      switch (key) {
        case 'ArrowDown':
        case 'ArrowRight':
          return play(adjacentTape(order, active, 1), ctx)
        case 'ArrowUp':
        case 'ArrowLeft':
          return play(adjacentTape(order, active, -1), ctx)
        case 'Enter':
        case ' ':
          return active === undefined ? play(order[0], ctx) : false
        default:
          return false
      }
    },
    hits({ width }) {
      return rows.flatMap((row, i) => (row.kind === 'tape' ? [rowRect(row.tape, i, width)] : []))
    },
    press(id, ctx) {
      play(
        tapes.find((tape) => tape.id === id),
        ctx,
      )
    },
  }
}
