import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import { MUSIC } from '../../../content/music'
import { font, FONT } from '../../../screens/fonts'

/**
 * The disc's printed face (512², drawn once): a silver rim with a faint
 * rainbow sheen, a deep teal print, an amber band sweeping through the middle
 * (so the spin reads through the lid's small window), the disc title and the
 * clear hub. Mapped by the disc's planar UV0 (glTF orientation, flipY off),
 * drawn flipped so it reads from the front of the player.
 */

export const DISC_LABEL_SIZE = 512

export function drawDiscLabel(g: CanvasRenderingContext2D, size = DISC_LABEL_SIZE): void {
  const c = size / 2
  const r = size / 2
  g.clearRect(0, 0, size, size)
  g.save()
  // The UVs put v = 0 at the front edge (u still runs left → right): flip
  // vertically so the print reads from the front of the player.
  g.translate(0, size)
  g.scale(1, -1)

  // Silver data side showing at the rim, with a faint rainbow sheen.
  const silver = g.createRadialGradient(c, c, r * 0.2, c, c, r)
  silver.addColorStop(0, '#c9ced6')
  silver.addColorStop(1, '#9ea5ae')
  g.fillStyle = silver
  g.fillRect(0, 0, size, size)
  const sheen = g.createConicGradient(0.6, c, c)
  for (const [stop, color] of [
    [0, 'rgba(255, 120, 160, 0.18)'],
    [0.2, 'rgba(255, 230, 120, 0.12)'],
    [0.4, 'rgba(120, 255, 200, 0.16)'],
    [0.6, 'rgba(120, 170, 255, 0.18)'],
    [0.8, 'rgba(220, 140, 255, 0.14)'],
    [1, 'rgba(255, 120, 160, 0.18)'],
  ] as const) {
    sheen.addColorStop(stop, color)
  }
  g.fillStyle = sheen
  g.fillRect(0, 0, size, size)

  // The printed label.
  const print = g.createLinearGradient(0, 0, size, size)
  print.addColorStop(0, '#173049')
  print.addColorStop(1, '#245c5f')
  g.beginPath()
  g.arc(c, c, r * 0.94, 0, Math.PI * 2)
  g.fillStyle = print
  g.fill()

  // Amber band from the hub to the rim on one side: the spin shows through the lid window.
  g.save()
  g.beginPath()
  g.arc(c, c, r * 0.94, 0, Math.PI * 2)
  g.clip()
  g.fillStyle = '#f0b44a'
  g.fillRect(c - r * 0.13, c - r, r * 0.26, r)
  g.fillStyle = '#e0573f'
  g.fillRect(c - r * 0.13, c - r, r * 0.07, r)
  g.restore()

  // Thin rings like a pressed label.
  g.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  g.lineWidth = 2
  for (const k of [0.52, 0.7, 0.86]) {
    g.beginPath()
    g.arc(c, c, r * k, 0, Math.PI * 2)
    g.stroke()
  }

  // Title and artist across the lower half (the readable side at rest).
  g.fillStyle = '#f4ead8'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = font(800, 34, FONT.ui)
  g.fillText(MUSIC.title.toUpperCase(), c, c + r * 0.5)
  g.font = font(400, 30, FONT.osd)
  g.fillText(MUSIC.artist, c, c + r * 0.7)

  // Clear plastic hub and the spindle hole.
  g.beginPath()
  g.arc(c, c, r * 0.3, 0, Math.PI * 2)
  g.fillStyle = 'rgba(210, 216, 224, 0.95)'
  g.fill()
  g.beginPath()
  g.arc(c, c, r * 0.14, 0, Math.PI * 2)
  g.fillStyle = '#121316'
  g.fill()
  g.restore()
}

/** The label texture (drawn once the fonts are in). */
export function createDiscLabelTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = DISC_LABEL_SIZE
  canvas.height = DISC_LABEL_SIZE
  const g = canvas.getContext('2d')
  if (g) drawDiscLabel(g)
  const texture = new CanvasTexture(canvas)
  texture.name = 'cd_disc_label'
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  return texture
}
