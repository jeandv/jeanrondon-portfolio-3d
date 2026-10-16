import type { Profile } from '../content/types'
import { font, FONT } from './fonts'

/** Polaroid canvas (plane 0.088 × 0.107 m → 4 px/mm). */
export const POLAROID_SIZE = { width: 352, height: 428 } as const

/** Photo extensions accepted for src/assets/photo.*, in priority order. */
export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const

/** Pure: the photo URL to use from a `{ path: url }` glob (first extension in priority order wins). */
export function pickPhotoUrl(files: Readonly<Record<string, string>>): string | undefined {
  for (const extension of PHOTO_EXTENSIONS) {
    const match = Object.entries(files).find(([path]) => path.toLowerCase().endsWith(`/photo.${extension}`))
    if (match) return match[1]
  }
  return undefined
}

/** "Jean Rondón" → "JR". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Instant-photo print: cream frame, square picture, handwritten caption.
 * Without a photo the picture is a warm gradient with the initials.
 */
export function drawPolaroid(g: CanvasRenderingContext2D, profile: Profile, photo?: CanvasImageSource & { width: number; height: number }): void {
  const { width, height } = g.canvas
  const border = Math.round(width * 0.07)
  const size = width - border * 2

  g.fillStyle = '#f1ece1'
  g.fillRect(0, 0, width, height)
  const paper = g.createLinearGradient(0, 0, width, height)
  paper.addColorStop(0, 'rgba(255, 255, 255, 0.25)')
  paper.addColorStop(1, 'rgba(120, 100, 70, 0.12)')
  g.fillStyle = paper
  g.fillRect(0, 0, width, height)

  g.save()
  g.beginPath()
  g.rect(border, border, size, size)
  g.clip()
  if (photo && photo.width > 0 && photo.height > 0) {
    // Cover-fit crop.
    const scale = Math.max(size / photo.width, size / photo.height)
    const w = photo.width * scale
    const h = photo.height * scale
    g.drawImage(photo, border + (size - w) / 2, border + (size - h) / 2, w, h)
  } else {
    const warm = g.createLinearGradient(border, border, border + size, border + size)
    warm.addColorStop(0, '#ffc27a')
    warm.addColorStop(0.55, '#d0566a')
    warm.addColorStop(1, '#3b2350')
    g.fillStyle = warm
    g.fillRect(border, border, size, size)
    g.font = font(900, size * 0.38, FONT.ui)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = 'rgba(255, 244, 228, 0.92)'
    g.fillText(initialsOf(profile.name), width / 2, border + size / 2)
  }
  // Soft vignette, like an instant print.
  const vignette = g.createRadialGradient(width / 2, border + size / 2, size * 0.25, width / 2, border + size / 2, size * 0.75)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
  g.fillStyle = vignette
  g.fillRect(border, border, size, size)
  g.restore()

  g.font = font(600, 40, FONT.hand)
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  g.fillStyle = '#2a2d4a'
  const captionY = border + size + (height - border - size) * 0.62
  g.fillText(profile.name.split(/\s+/)[0] ?? profile.name, width / 2, captionY)
}
