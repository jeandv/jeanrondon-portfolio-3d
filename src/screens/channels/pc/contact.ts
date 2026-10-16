import { displayHref } from '../../../content/links'
import type { ContactLink } from '../../../content/types'
import type { Channel, ChannelContext } from '../../channel'
import { blinkOn } from '../../draw'
import type { HitRect } from '../../hit'
import { ellipsize, monoMeasure } from '../../text'
import {
  blockCursor,
  charWidth,
  clearTerm,
  PC_BG,
  PC_MARGIN,
  PHOSPHOR,
  PHOSPHOR_DIM,
  TERM_LINE,
  TERM_SIZE,
  TERM_TOP,
  termLine,
} from './term'

const FIRST_LINK_ROW = 5
const LABEL_COLS = 10

/** Menu row text: `[1] EMAIL      jeanrdev@gmail.com`. */
export function contactRow(link: ContactLink, index: number, cols: number): string {
  const text = `[${index + 1}] ${link.label.toUpperCase().padEnd(LABEL_COLS)} ${displayHref(link.href)}`
  return ellipsize(text, cols, monoMeasure(1))
}

function rowRect(link: ContactLink, index: number, width: number): HitRect {
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

/** BBS contact menu: arrows/Enter, number keys or a click open the link. */
export function createContactChannel(links: readonly ContactLink[]): Channel {
  let selected = 0

  const open = (index: number, ctx: ChannelContext): void => {
    const link = links[index]
    if (!link) return
    selected = index
    ctx.openLink(link.href)
  }

  return {
    id: 'contact',
    fps: 2,
    enter() {
      selected = 0
    },
    draw(g, t, { width, height, hover, reducedMotion }) {
      clearTerm(g, width, height)
      const cw = charWidth(g)
      const cols = Math.floor((width - PC_MARGIN * 2) / cw)
      termLine(g, 'C:\\> DIAL JEAN-NET', 0, PHOSPHOR_DIM)
      termLine(g, 'CONNECT 2400', 1, PHOSPHOR_DIM)
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
    },
    key(key, ctx) {
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
    hits({ width }) {
      return links.map((link, i) => rowRect(link, i, width))
    },
    press(id, ctx) {
      open(
        links.findIndex((link) => link.id === id),
        ctx,
      )
    },
  }
}
