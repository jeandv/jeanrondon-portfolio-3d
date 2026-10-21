import { isWink, MAX_DIGITS, type CalcState } from '../../../three/objects/calc/engine'
import type { Channel, ChannelContext } from '../../channel'
import { font, FONT } from '../../fonts'
import { drawSegments, segmentCells, type SegmentStyle } from '../../sevenSeg'

/**
 * The calculator's LCD (`calc_display`, 480×160): a grey-green reflective
 * panel with 10 digits (+ a sign cell) in seven segments, calculator style
 * (`42.`), the pending operator in the corner, `E` on errors and a tiny
 * wink for 58008 / 0.7734. Redrawn only when the calculator changes.
 */

export const DISPLAY_SIZE = { width: 480, height: 160 } as const

const INK = '#1b2318'
const SEGMENTS: SegmentStyle = { on: INK, off: 'rgba(27, 35, 24, 0.06)', thickness: 0.19, slant: 0.1 }
const CELLS = MAX_DIGITS + 1
const OP_SIGN: Readonly<Record<string, string>> = { '+': '+', '-': '-', '*': 'x', '/': '/' }

/** What the cells show: the readout, or `E` at the left and `0.` at the right. */
export function displayText(state: CalcState): string {
  return state.error ? `E${' '.repeat(CELLS - 2)}0` : state.display
}

export interface DisplayHooks {
  readonly state: () => CalcState
}

class DisplayChannel implements Channel {
  readonly id = 'calc/display'
  readonly fps = 0
  private readonly hooks: DisplayHooks

  constructor(hooks: DisplayHooks) {
    this.hooks = hooks
  }

  draw(g: CanvasRenderingContext2D, _t: number, ctx: ChannelContext): void {
    const { width, height } = ctx
    const state = this.hooks.state()
    // Bezel and the reflective panel.
    g.fillStyle = '#15161a'
    g.fillRect(0, 0, width, height)
    const panel = g.createLinearGradient(0, 10, 0, height - 10)
    panel.addColorStop(0, '#b2bf9f')
    panel.addColorStop(1, '#9aa889')
    g.fillStyle = panel
    g.beginPath()
    g.roundRect(10, 10, width - 20, height - 20, 10)
    g.fill()

    const pitch = (width - 52) / CELLS
    drawSegments(g, segmentCells(displayText(state), CELLS, true), 22, 46, pitch * 0.72, 86, pitch, SEGMENTS)

    g.fillStyle = INK
    g.font = font(400, 26, FONT.osd)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    if (state.op && !state.error) g.fillText(OP_SIGN[state.op] ?? '', 24, 38)
    if (state.error) g.fillText('ERR', 24, 38)
    if (isWink(state)) {
      g.textAlign = 'right'
      g.fillText(';)', width - 24, 38)
    }
  }
}

export function createDisplayChannel(hooks: DisplayHooks): Channel {
  return new DisplayChannel(hooks)
}
