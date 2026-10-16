import type { Channel } from '../../channel'
import { blinkOn, osdText } from '../../draw'
import { slotKeys } from '../../keys'
import { channelOsd, VCR_BLUE } from './osd'

/** #work without a tape: blue screen with a blinking INSERT TAPE (`slots`: the shelf slots with a tape). */
export function createInsertTapeChannel(slots: readonly number[]): Channel {
  return {
    id: 'insertTape',
    fps: 4,
    draw(g, t, { width, height, reducedMotion }) {
      g.fillStyle = VCR_BLUE
      g.fillRect(0, 0, width, height)
      channelOsd(g, 'CH 03', width)
      if (reducedMotion || blinkOn(t, 0.8)) {
        osdText(g, 'INSERT TAPE', width / 2, height / 2 + 16, { size: 72, align: 'center' })
      }
      osdText(g, `PICK ONE FROM THE NOTEPAD OR PRESS ${slotKeys(slots)}`, width / 2, height - 56, {
        size: 28,
        align: 'center',
      })
    },
  }
}
