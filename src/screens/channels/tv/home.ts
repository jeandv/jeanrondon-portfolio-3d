import type { Profile } from '../../../content/types'
import type { Channel } from '../../channel'
import { formatCounter, osdText } from '../../draw'
import { font, FONT } from '../../fonts'
import { fitSize } from '../../text'
import { channelOsd, playOsd, TV_ACCENT, TV_BLACK, TV_MARGIN } from './osd'

/** The tape counter starts mid-tape, like a VCR left playing. */
const COUNTER_START = 12 * 60 + 31

/** Title card: name + role, with a ticking VCR counter. */
export function createHomeChannel(profile: Profile): Channel {
  return {
    id: 'home',
    fps: 2,
    draw(g, t, { width, height }) {
      g.fillStyle = TV_BLACK
      g.fillRect(0, 0, width, height)

      playOsd(g)
      channelOsd(g, 'SP', width)

      const name = profile.name.toUpperCase()
      const maxWidth = width - TV_MARGIN * 2 - 20
      const size = fitSize(maxWidth, 70, 30, (s) => {
        g.font = font(900, s, FONT.ui)
        return g.measureText(name).width
      })
      const cy = height / 2
      g.font = font(900, size, FONT.ui)
      g.textAlign = 'center'
      g.fillStyle = '#ffffff'
      g.fillText(name, width / 2, cy + size * 0.2)

      g.fillStyle = TV_ACCENT
      g.fillRect(width / 2 - 60, cy + size * 0.2 + 22, 120, 3)
      osdText(g, profile.role.toUpperCase(), width / 2, cy + size * 0.2 + 68, {
        size: 36,
        color: TV_ACCENT,
        align: 'center',
        shadow: false,
      })

      osdText(g, formatCounter(COUNTER_START + t), width - TV_MARGIN, height - 36, { size: 38, align: 'right' })
    },
  }
}
