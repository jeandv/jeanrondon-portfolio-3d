import type { Channel } from '../../channel'
import { drawNoise } from '../../draw'

/** Snow between channels (also the transition CanvasScreen plays for 280 ms). */
export const STATIC_CHANNEL: Channel = {
  id: 'static',
  fps: 30,
  draw(g, t, { width, height }) {
    g.fillStyle = '#000000'
    g.fillRect(0, 0, width, height)
    drawNoise(g, 0, 0, width, height, 0.9)
    // A brighter roll bar sweeping down.
    const bar = 60
    const y = ((t * 900) % (height + bar)) - bar
    g.fillStyle = 'rgba(255, 255, 255, 0.10)'
    g.fillRect(0, y, width, bar)
  },
}
