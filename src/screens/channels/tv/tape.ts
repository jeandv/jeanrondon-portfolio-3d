import type { Tape } from '../../../content/types'
import type { Channel } from '../../channel'
import { formatCounter, osdText, trackingBands } from '../../draw'
import { font, FONT } from '../../fonts'
import type { HitRect } from '../../hit'
import { canvasMeasure, ellipsize, fitSize, wrapText } from '../../text'
import { channelOsd, playOsd, TV_ACCENT, TV_BLACK, TV_MARGIN, TV_YELLOW } from './osd'

/** Seconds before the first bullet, between bullets, and of tracking noise. */
const REVEAL_START = 0.6
const REVEAL_STEP = 0.5
const TRACKING_SECONDS = 0.9
const BODY = 26
const MAX_SUMMARY_LINES = 2
const MAX_BULLET_LINES = 2

function openRect(width: number, height: number, label: string): HitRect {
  const w = 250
  return { id: 'open', x: width - TV_MARGIN - w, y: height - 54, w, h: 38, label }
}

/** Content entries that are still blank are skipped (no empty bullet, chip or separator). */
function filled(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}

/** One tape = one company/project: title, years, role, bullets one by one, stack chips. */
export function createTapeChannel(tape: Tape): Channel {
  const bullets = filled(tape.bullets)
  const stack = filled(tape.stack)
  const meta = filled([tape.years, tape.role]).join('  /  ').toUpperCase()
  const revealEnd = REVEAL_START + REVEAL_STEP * bullets.length
  const openLabel = tape.kind === 'project' ? 'OPEN PROJECT' : 'OPEN LINK'
  let lastT = 0
  let reduced = false

  return {
    id: `tape/${tape.id}`,
    get fps() {
      return !reduced && lastT < Math.max(revealEnd, TRACKING_SECONDS) ? 30 : 2
    },
    enter() {
      lastT = 0
    },
    draw(g, t, { width, height, reducedMotion, hover }) {
      lastT = t
      reduced = reducedMotion
      const left = TV_MARGIN
      const maxWidth = width - TV_MARGIN * 2

      g.fillStyle = TV_BLACK
      g.fillRect(0, 0, width, height)
      playOsd(g)
      channelOsd(g, `CH ${String(tape.slot).padStart(2, '0')}`, width)

      let y = 106
      osdText(g, tape.kind === 'company' ? 'COMPANY' : 'PROJECT', left, y, {
        size: 28,
        color: TV_YELLOW,
        shadow: false,
      })

      const title = tape.title.toUpperCase()
      const titleSize = fitSize(maxWidth, 54, 26, (s) => {
        g.font = font(900, s, FONT.ui)
        return g.measureText(title).width
      })
      y += 8 + titleSize
      g.font = font(900, titleSize, FONT.ui)
      g.textAlign = 'left'
      g.fillStyle = '#ffffff'
      // Still too long at the smallest size: ellipsize.
      g.fillText(ellipsize(title, maxWidth, canvasMeasure(g)), left, y)

      g.font = font(400, 30, FONT.osd)
      const measure = canvasMeasure(g)
      y += 36
      osdText(g, ellipsize(meta, maxWidth, measure), left, y, { size: 30, color: TV_ACCENT, shadow: false })

      g.font = font(400, BODY, FONT.osd)
      y += 8
      for (const line of wrapText(tape.summary, maxWidth, measure).slice(0, MAX_SUMMARY_LINES)) {
        y += BODY
        osdText(g, line, left, y, { size: BODY, color: '#d8dce8', shadow: false })
      }

      const chipsTop = height - 100
      y += 10
      bullets.forEach((bullet, i) => {
        if (!reducedMotion && t < REVEAL_START + i * REVEAL_STEP) return
        g.font = font(400, BODY, FONT.osd)
        const lines = wrapText(bullet, maxWidth - 24, measure).slice(0, MAX_BULLET_LINES)
        lines.forEach((line, j) => {
          if (y + BODY > chipsTop - 6) return
          y += BODY
          if (j === 0) osdText(g, '>', left, y, { size: BODY, color: TV_YELLOW, shadow: false })
          osdText(g, line, left + 24, y, { size: BODY })
        })
      })

      // Stack chips.
      g.font = font(400, 24, FONT.osd)
      let x = left
      for (const item of stack) {
        const label = item.toUpperCase()
        const w = Math.ceil(measure(label)) + 20
        if (x + w > width - TV_MARGIN) break
        g.strokeStyle = TV_ACCENT
        g.lineWidth = 2
        g.strokeRect(x + 1, chipsTop + 1, w - 2, 30)
        osdText(g, label, x + 10, chipsTop + 23, { size: 24, color: TV_ACCENT, shadow: false })
        x += w + 10
      }

      osdText(g, `SP ${formatCounter(t)}`, left, height - 24, { size: 30 })

      if (tape.url) {
        const rect = openRect(width, height, openLabel)
        const active = hover === rect.id
        g.fillStyle = active ? '#ffffff' : 'rgba(255, 255, 255, 0.08)'
        g.fillRect(rect.x, rect.y, rect.w, rect.h)
        g.strokeStyle = '#ffffff'
        g.lineWidth = 2
        g.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2)
        osdText(g, `ENTER: ${openLabel}`, rect.x + rect.w / 2, rect.y + 28, {
          size: 26,
          align: 'center',
          color: active ? '#000000' : '#ffffff',
          shadow: false,
        })
      }

      if (!reducedMotion && t < TRACKING_SECONDS) trackingBands(g, t, 1 - t / TRACKING_SECONDS)
    },
    key(key, ctx) {
      if ((key === 'Enter' || key === ' ') && tape.url) {
        ctx.openLink(tape.url)
        return true
      }
      return false
    },
    hits({ width, height }) {
      return tape.url ? [openRect(width, height, `${openLabel} ↗`)] : []
    },
    press(id, ctx) {
      if (id === 'open' && tape.url) ctx.openLink(tape.url)
    },
  }
}
