import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import { DISCS, type DiscInfo } from '../../../audio/music/discs'
import { font, FONT } from '../../../screens/fonts'
import { random } from '../tapes/labelAtlas'

/**
 * The disc's printed face (512², redrawn when the disc changes): a silver rim
 * with a faint rainbow sheen, the print, a band sweeping from the hub to the
 * rim (so the spin reads through the lid's small window), the disc's title
 * and the clear hub. Disc 1 (the generated lo-fi): a deep teal print with an
 * amber band. Disc 2 (Joji): an original pastel night (no album art): a
 * peach-to-lavender sky, falling rain, a crescent moon and a widely tracked
 * name. Mapped by the disc's planar UV0 (glTF orientation, flipY off), drawn
 * flipped so it reads from the front of the player.
 */

export const DISC_LABEL_SIZE = 512

function silver(g: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  const r = size / 2
  const metal = g.createRadialGradient(c, c, r * 0.2, c, c, r)
  metal.addColorStop(0, '#c9ced6')
  metal.addColorStop(1, '#9ea5ae')
  g.fillStyle = metal
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
}

function hub(g: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  const r = size / 2
  g.beginPath()
  g.arc(c, c, r * 0.3, 0, Math.PI * 2)
  g.fillStyle = 'rgba(210, 216, 224, 0.95)'
  g.fill()
  g.beginPath()
  g.arc(c, c, r * 0.14, 0, Math.PI * 2)
  g.fillStyle = '#121316'
  g.fill()
}

function clipPrint(g: CanvasRenderingContext2D, size: number): void {
  g.beginPath()
  g.arc(size / 2, size / 2, (size / 2) * 0.94, 0, Math.PI * 2)
  g.clip()
}

function tapesPrint(g: CanvasRenderingContext2D, size: number, disc: DiscInfo): void {
  const c = size / 2
  const r = size / 2
  g.save()
  clipPrint(g, size)
  const print = g.createLinearGradient(0, 0, size, size)
  print.addColorStop(0, '#173049')
  print.addColorStop(1, '#245c5f')
  g.fillStyle = print
  g.fillRect(0, 0, size, size)
  // Amber band from the hub to the rim on one side: the spin shows through the lid window.
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
  g.fillStyle = '#f4ead8'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = font(800, 34, FONT.ui)
  g.fillText(disc.title.toUpperCase(), c, c + r * 0.5)
  g.font = font(400, 30, FONT.osd)
  g.fillText(disc.artist, c, c + r * 0.7)
}

function jojiPrint(g: CanvasRenderingContext2D, size: number, disc: DiscInfo): void {
  const c = size / 2
  const r = size / 2
  g.save()
  clipPrint(g, size)
  const sky = g.createLinearGradient(0, 0, 0, size)
  sky.addColorStop(0, '#a9a3d6')
  sky.addColorStop(0.55, '#f2c9b8')
  sky.addColorStop(1, '#f7e3d3')
  g.fillStyle = sky
  g.fillRect(0, 0, size, size)
  // A dusk-blue band from the hub to the rim (the spin reads through the lid window).
  g.fillStyle = 'rgba(59, 51, 82, 0.85)'
  g.fillRect(c - r * 0.12, c - r, r * 0.24, r)
  // Rain.
  g.strokeStyle = 'rgba(255, 255, 255, 0.5)'
  g.lineWidth = 2
  g.beginPath()
  const rand = random(0x6a6f6a69)
  for (let i = 0; i < 46; i++) {
    const x = rand() * size
    const y = rand() * size
    g.moveTo(x, y)
    g.lineTo(x - 6, y + 22)
  }
  g.stroke()
  g.restore()
  // Crescent moon (a disc minus an offset disc).
  g.save()
  g.beginPath()
  g.arc(c + r * 0.42, c - r * 0.36, r * 0.13, 0, Math.PI * 2)
  g.fillStyle = '#fff4e6'
  g.fill()
  g.globalCompositeOperation = 'destination-out'
  g.beginPath()
  g.arc(c + r * 0.48, c - r * 0.4, r * 0.11, 0, Math.PI * 2)
  g.fill()
  g.restore()
  g.fillStyle = '#3b3352'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = font(300, 44, FONT.ui)
  const name = disc.title.toLowerCase().split('').join('  ')
  g.fillText(name, c, c + r * 0.5)
  g.font = font(400, 24, FONT.osd)
  g.fillText(`${disc.tracks.length} TRACKS - VIA YOUTUBE`, c, c + r * 0.7)
}

export function drawDiscLabel(g: CanvasRenderingContext2D, disc: DiscInfo = DISCS.tapes, size = DISC_LABEL_SIZE): void {
  g.clearRect(0, 0, size, size)
  g.save()
  // The UVs put v = 0 at the front edge (u still runs left → right): flip
  // vertically so the print reads from the front of the player.
  g.translate(0, size)
  g.scale(1, -1)
  silver(g, size)
  if (disc.source === 'youtube') jojiPrint(g, size, disc)
  else tapesPrint(g, size, disc)
  hub(g, size)
  g.restore()
}

/** The label texture (drawn once the fonts are in; `redraw` for another disc). */
export function createDiscLabelTexture(disc: DiscInfo = DISCS.tapes): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = DISC_LABEL_SIZE
  canvas.height = DISC_LABEL_SIZE
  const g = canvas.getContext('2d')
  if (g) drawDiscLabel(g, disc)
  const texture = new CanvasTexture(canvas)
  texture.name = 'cd_disc_label'
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  return texture
}

/** Reprints the label for `disc` on an existing texture. */
export function redrawDiscLabel(texture: CanvasTexture, disc: DiscInfo): void {
  const g = (texture.image as HTMLCanvasElement).getContext('2d')
  if (!g) return
  drawDiscLabel(g, disc)
  texture.needsUpdate = true
}
