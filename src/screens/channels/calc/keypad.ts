import { keyFromKeyboard, type CalcKey } from '../../../three/objects/calc/engine'
import type { Channel, ChannelContext } from '../../channel'
import { font, FONT } from '../../fonts'
import type { HitRect } from '../../hit'

/**
 * The calculator's keypad (`calc_keys`, 520×626): 4 × 5 rubber keys drawn on
 * a canvas, each a hit rect. A pressed key (click or physical key) shows a
 * darker cap for ~100 ms; the channel redraws only then (fps 0 otherwise).
 *
 *   CE  C  ±  ÷
 *   7   8  9  ×
 *   4   5  6  −
 *   1   2  3  +
 *   0      .  =
 */

export const KEYPAD_SIZE = { width: 520, height: 626 } as const
export const PRESS_SECONDS = 0.1

interface KeyDef {
  readonly key: CalcKey
  readonly label: string
  readonly col: number
  readonly row: number
  readonly span?: number
  readonly kind: 'digit' | 'op' | 'clear' | 'equals'
}

export const KEYPAD: readonly KeyDef[] = [
  { key: 'CE', label: 'CE', col: 0, row: 0, kind: 'clear' },
  { key: 'C', label: 'C', col: 1, row: 0, kind: 'clear' },
  { key: 'neg', label: '±', col: 2, row: 0, kind: 'op' },
  { key: '/', label: '÷', col: 3, row: 0, kind: 'op' },
  { key: '7', label: '7', col: 0, row: 1, kind: 'digit' },
  { key: '8', label: '8', col: 1, row: 1, kind: 'digit' },
  { key: '9', label: '9', col: 2, row: 1, kind: 'digit' },
  { key: '*', label: '×', col: 3, row: 1, kind: 'op' },
  { key: '4', label: '4', col: 0, row: 2, kind: 'digit' },
  { key: '5', label: '5', col: 1, row: 2, kind: 'digit' },
  { key: '6', label: '6', col: 2, row: 2, kind: 'digit' },
  { key: '-', label: '-', col: 3, row: 2, kind: 'op' },
  { key: '1', label: '1', col: 0, row: 3, kind: 'digit' },
  { key: '2', label: '2', col: 1, row: 3, kind: 'digit' },
  { key: '3', label: '3', col: 2, row: 3, kind: 'digit' },
  { key: '+', label: '+', col: 3, row: 3, kind: 'op' },
  { key: '0', label: '0', col: 0, row: 4, span: 2, kind: 'digit' },
  { key: '.', label: '.', col: 2, row: 4, kind: 'digit' },
  { key: '=', label: '=', col: 3, row: 4, kind: 'equals' },
]

const MARGIN = 20
const GAP = 14
const COLS = 4
const ROWS = 5

/** A key's rect on the canvas. */
export function keyRect(def: KeyDef, width = KEYPAD_SIZE.width, height = KEYPAD_SIZE.height): { x: number; y: number; w: number; h: number } {
  const w = (width - 2 * MARGIN - (COLS - 1) * GAP) / COLS
  const h = (height - 2 * MARGIN - (ROWS - 1) * GAP) / ROWS
  const span = def.span ?? 1
  return { x: MARGIN + def.col * (w + GAP), y: MARGIN + def.row * (h + GAP), w: w * span + GAP * (span - 1), h }
}

const CAP: Readonly<Record<KeyDef['kind'], { readonly top: string; readonly bottom: string; readonly ink: string }>> = {
  digit: { top: '#5a5e67', bottom: '#3c3f46', ink: '#eef0f2' },
  op: { top: '#7b808b', bottom: '#5a5e67', ink: '#ffffff' },
  clear: { top: '#d0654a', bottom: '#a7432f', ink: '#fff4ec' },
  equals: { top: '#f0b25a', bottom: '#c98a2e', ink: '#2a1a08' },
}

function drawKey(g: CanvasRenderingContext2D, def: KeyDef, pressed: boolean, hovered: boolean): void {
  const { x, y, w, h } = keyRect(def)
  const cap = CAP[def.kind]
  const sink = pressed ? 4 : 0
  // Shadow / skirt under the cap.
  g.fillStyle = 'rgba(0, 0, 0, 0.55)'
  g.beginPath()
  g.roundRect(x, y + 6, w, h - 2, 16)
  g.fill()
  const face = g.createLinearGradient(0, y, 0, y + h)
  face.addColorStop(0, pressed ? cap.bottom : cap.top)
  face.addColorStop(1, pressed ? '#1d1f23' : cap.bottom)
  g.fillStyle = face
  g.beginPath()
  g.roundRect(x, y + sink, w, h - 6, 16)
  g.fill()
  if (hovered && !pressed) {
    g.strokeStyle = 'rgba(255, 220, 170, 0.6)'
    g.lineWidth = 3
    g.stroke()
  }
  g.fillStyle = pressed ? 'rgba(255, 255, 255, 0.55)' : cap.ink
  const cx = x + w / 2
  const cy = y + sink + (h - 6) / 2
  if (def.key === '-') {
    // A real minus bar (the hyphen glyph is too short).
    g.fillRect(cx - 18, cy - 4, 36, 8)
    return
  }
  const size = def.label.length > 1 ? 40 : 54
  g.font = font(800, size, FONT.ui)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(def.label, cx, cy + 2)
}

export interface KeypadHooks {
  readonly press: (key: CalcKey) => void
}

class KeypadChannel implements Channel {
  readonly id = 'calc/keypad'
  private readonly hooks: KeypadHooks
  private pressed: { readonly key: CalcKey; readonly at: number } | null = null

  constructor(hooks: KeypadHooks) {
    this.hooks = hooks
  }

  /** Idle (redraw on demand) except while a key shows pressed. */
  get fps(): number {
    return this.pressed ? 30 : 0
  }

  draw(g: CanvasRenderingContext2D, t: number, ctx: ChannelContext): void {
    const { width, height } = ctx
    const body = g.createLinearGradient(0, 0, 0, height)
    body.addColorStop(0, '#303238')
    body.addColorStop(1, '#25272c')
    g.fillStyle = body
    g.fillRect(0, 0, width, height)
    const down = this.pressed && t - this.pressed.at < PRESS_SECONDS ? this.pressed.key : null
    for (const def of KEYPAD) drawKey(g, def, def.key === down, ctx.hover === def.key)
    // Drawn unpressed once its time is up: back to idle.
    if (this.pressed && !down) this.pressed = null
  }

  hits(): readonly HitRect[] {
    // Empty labels: the pointer turns into a hand, no tooltip over the keys.
    return KEYPAD.map((def) => ({ id: def.key, ...keyRect(def), label: '' }))
  }

  press(id: string, ctx: ChannelContext): void {
    const def = KEYPAD.find((entry) => entry.key === id)
    if (!def) return
    this.pressed = { key: def.key, at: ctx.time }
    this.hooks.press(def.key)
    ctx.invalidate()
  }

  /** Physical keys (and Escape as C), with the same pressed cap. */
  key(key: string, ctx: ChannelContext): boolean {
    const calcKey = key === 'Escape' ? 'C' : keyFromKeyboard(key)
    if (!calcKey) return false
    this.press(calcKey, ctx)
    return true
  }
}

export function createKeypadChannel(hooks: KeypadHooks): Channel {
  return new KeypadChannel(hooks)
}
