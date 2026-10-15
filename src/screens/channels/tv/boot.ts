import type { Channel } from '../../channel'
import { osdText } from '../../draw'
import { TV_MARGIN, VCR_BLUE } from './osd'

/** Power-on: VCR blue with the "CH 03" OSD. */
export function createBootChannel(): Channel {
  return {
    id: 'boot',
    fps: 2,
    draw(g, _t, { width, height }) {
      g.fillStyle = VCR_BLUE
      g.fillRect(0, 0, width, height)
      osdText(g, 'CH 03', TV_MARGIN, 76, { size: 64 })
    },
  }
}
