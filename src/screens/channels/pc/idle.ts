import type { Channel } from '../../channel'
import { blinkOn } from '../../draw'
import { blockCursor, charWidth, clearTerm, PHOSPHOR_DIM, termLine } from './term'

const PROMPT = 'C:\\>'

/** Idle DOS prompt with a blinking cursor. */
export function createIdleChannel(): Channel {
  return {
    id: 'idle',
    fps: 4,
    draw(g, t, { width, height, reducedMotion }) {
      clearTerm(g, width, height)
      termLine(g, 'JEAN-DOS 6.22', 0, PHOSPHOR_DIM)
      termLine(g, '640K OK', 1, PHOSPHOR_DIM)
      termLine(g, PROMPT, 3)
      if (reducedMotion || blinkOn(t, 1)) blockCursor(g, PROMPT.length, 3, charWidth(g))
    },
  }
}
