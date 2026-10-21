import type { DiscInfo } from '../../../audio/music/discs'
import type { SourceStatus } from '../../../audio/music/source'
import { VOLUME_SEGMENTS, volumeSegments } from '../../../audio/volume'
import type { CdLid } from '../../../three/objects/cd/player'
import type { Channel, ChannelContext } from '../../channel'
import { blinkOn, playGlyph } from '../../draw'
import { font, FONT } from '../../fonts'
import type { HitRect } from '../../hit'
import { drawSegments, formatTrackTime, segmentCells, type SegmentStyle } from '../../sevenSeg'
import { CD_BUTTON_ORDER, CD_BUTTONS, type CdButton } from './layout'

export { CD_BUTTONS, CD_LCD_SIZE, type CdButton } from './layout'

/**
 * The CD player's front strip (`cd_display`, 720×160), source-agnostic (the
 * generated disc or the YouTube one): a backlit LCD with the disc, the track
 * number and the elapsed / total time in seven segments, a status icon, REP
 * and MUTE flags, a 10-segment volume bar and the title scrolling a
 * character at a time (VT323); then seven rubber keys as hit rects:
 * PREV, PLAY/PAUSE, NEXT, STOP (eject) / VOL−, VOL+, DISC. Opening the lid
 * reads OPEn; a video that cannot play reads Err while it skips.
 */

const LCD = { x: 12, y: 12, w: 444, h: 136 } as const
const INK = '#132a1c'
const GHOST = 'rgba(19, 42, 28, 0.07)'
const SEGMENTS: SegmentStyle = { on: INK, off: GHOST, thickness: 0.2, slant: 0.1 }
/** Title scroll speed (characters per second, LCD style). */
export const SCROLL_CPS = 4
/** Seconds a pressed button shows pressed. */
const PRESS_SECONDS = 0.14

export interface CdLcdView {
  readonly lid: CdLid
  readonly disc: DiscInfo
  readonly status: SourceStatus
  /** 0-based. */
  readonly track: number
  readonly elapsed: number
  /** Null while unknown (a video still loading). */
  readonly duration: number | null
  /** SOUND OFF: the MUTE flag. */
  readonly muted: boolean
  /** 0–100. */
  readonly volume: number
  /** A video that cannot play: Err for a moment, then the next one. */
  readonly error: boolean
}

export interface CdLcdHooks {
  readonly view: () => CdLcdView
  readonly press: (button: CdButton) => void
  /** Digit keys pick a track (0-based). */
  readonly playTrack: (index: number) => void
}

/** The line that scrolls: the track (number, title, artist) or, stopped, the disc. */
export function lcdLine(view: CdLcdView): string {
  const { disc, track } = view
  const number = String(track + 1).padStart(2, '0')
  if (view.lid === 'open') return `OPEN - DISC ${disc.number} ${disc.title}`.toUpperCase()
  if (view.error) return `${number} CANNOT PLAY - SKIPPING`
  if (view.status === 'stopped') {
    const via = disc.source === 'youtube' ? ' - VIA YOUTUBE' : ''
    return `DISC ${disc.number} ${disc.title} - ${disc.tracks.length} TRACKS${via}`.toUpperCase()
  }
  const title = disc.tracks[track] ?? `TRACK ${track + 1}`
  return `${number} ${title} - ${disc.artist}`.toUpperCase()
}

/** The visible window of a scrolling line at time `t` (whole characters, wrapping with a gap). */
export function scrollWindow(text: string, visible: number, t: number): string {
  if (text.length <= visible) return text
  const loop = `${text}    `
  const offset = Math.floor(t * SCROLL_CPS) % loop.length
  return (loop + loop).slice(offset, offset + visible)
}

/** Key → button in the close-up: Space / Enter play-pause, ←→ track, ↑↓ / − + volume, S stop, D disc. */
export function cdKeyButton(key: string): CdButton | null {
  switch (key) {
    case ' ':
    case 'Enter':
      return 'play'
    case 'ArrowRight':
    case 'PageDown':
      return 'next'
    case 'ArrowLeft':
    case 'PageUp':
      return 'prev'
    case 'ArrowUp':
    case '+':
    case '=':
      return 'volup'
    case 'ArrowDown':
    case '-':
    case '_':
      return 'voldown'
    case 's':
    case 'S':
      return 'stop'
    case 'd':
    case 'D':
      return 'disc'
    default:
      return null
  }
}

function drawPanel(g: CanvasRenderingContext2D, width: number, height: number): void {
  const panel = g.createLinearGradient(0, 0, 0, height)
  panel.addColorStop(0, '#2a2d34')
  panel.addColorStop(1, '#17191d')
  g.fillStyle = panel
  g.fillRect(0, 0, width, height)
  // Backlit LCD window with a soft bezel.
  g.beginPath()
  g.roundRect(LCD.x - 4, LCD.y - 4, LCD.w + 8, LCD.h + 8, 12)
  g.fillStyle = '#0c0d10'
  g.fill()
  const glass = g.createLinearGradient(0, LCD.y, 0, LCD.y + LCD.h)
  glass.addColorStop(0, '#b4e0aa')
  glass.addColorStop(1, '#8fc78e')
  g.beginPath()
  g.roundRect(LCD.x, LCD.y, LCD.w, LCD.h, 8)
  g.fillStyle = glass
  g.fill()
}

function drawHeader(g: CanvasRenderingContext2D, view: CdLcdView, t: number): void {
  g.font = font(400, 20, FONT.osd)
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = INK
  g.fillText(`DISC ${view.disc.number}`, 24, 34)
  g.fillText(view.disc.title.toUpperCase().slice(0, 18), 92, 34)
  // Status icon.
  const x = 300
  const y = 27
  if (view.status === 'playing' || (view.status === 'loading' && blinkOn(t, 2))) {
    playGlyph(g, x, y, 16, INK)
  } else if (view.status === 'paused') {
    if (blinkOn(t, 1)) {
      g.fillRect(x, y - 8, 5, 16)
      g.fillRect(x + 9, y - 8, 5, 16)
    }
  } else if (view.status === 'stopped') {
    g.fillRect(x, y - 7, 14, 14)
  }
  g.fillText('REP', 326, 34)
  g.fillStyle = view.muted ? INK : GHOST
  g.fillText('MUTE', 366, 34)
  g.fillStyle = view.disc.source === 'youtube' ? INK : GHOST
  g.fillText('NET', 414, 34)
}

function drawTimes(g: CanvasRenderingContext2D, view: CdLcdView, t: number): void {
  g.fillStyle = INK
  g.font = font(400, 16, FONT.osd)
  g.fillText('TRACK', 24, 50)
  drawSegments(g, segmentCells(String(view.track + 1).padStart(2, '0'), 2), 24, 54, 24, 42, 32, SEGMENTS)
  if (view.lid === 'open') {
    drawSegments(g, segmentCells('OPEn', 4), 100, 54, 24, 42, 36, SEGMENTS)
    return
  }
  if (view.error) {
    const style = blinkOn(t, 2) ? SEGMENTS : { ...SEGMENTS, on: GHOST }
    drawSegments(g, segmentCells(' Err', 4), 100, 54, 24, 42, 36, style)
    return
  }
  g.fillText('TIME', 100, 50)
  const loading = view.status === 'loading' && view.elapsed <= 0
  const [minutes = '0', seconds = '00'] = formatTrackTime(Math.max(0, view.elapsed)).split(':')
  const showTime = view.status !== 'paused' || blinkOn(t, 1)
  const style = showTime ? SEGMENTS : { ...SEGMENTS, on: GHOST }
  drawSegments(g, segmentCells(loading ? '--' : minutes, 2), 100, 54, 24, 42, 32, style)
  g.fillStyle = showTime ? INK : GHOST
  g.fillRect(170, 64, 6, 6)
  g.fillRect(170, 82, 6, 6)
  drawSegments(g, segmentCells(loading ? '--' : seconds, 2), 184, 54, 24, 42, 32, style)
  // Total length, small, after a slash.
  g.fillStyle = INK
  g.font = font(400, 24, FONT.osd)
  const total = view.duration === null ? '-:--' : formatTrackTime(view.duration)
  g.fillText(`/${total}`, 256, 94)
}

function drawVolume(g: CanvasRenderingContext2D, volume: number): void {
  const lit = volumeSegments(volume)
  const x0 = 352
  const bottom = 94
  g.font = font(400, 16, FONT.osd)
  g.fillStyle = INK
  g.fillText('VOL', x0, 50)
  for (let i = 0; i < VOLUME_SEGMENTS; i++) {
    const h = 8 + i * 3.2
    g.fillStyle = i < lit ? INK : GHOST
    g.fillRect(x0 + i * 9, bottom - h, 6, h)
  }
}

function drawGlyph(g: CanvasRenderingContext2D, button: CdButton, cx: number, cy: number, s: number, playing: boolean, ink: string): void {
  g.fillStyle = ink
  switch (button) {
    case 'play':
      playGlyph(g, cx - s * 1.0, cy, s * 1.1, ink)
      g.fillRect(cx + s * 0.2, cy - s * 0.5, s * 0.28, s)
      g.fillRect(cx + s * 0.62, cy - s * 0.5, s * 0.28, s)
      if (playing) {
        g.save()
        g.fillStyle = '#7dff9a'
        g.beginPath()
        g.arc(cx, cy + s * 1.25, 3, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }
      return
    case 'prev':
    case 'next': {
      const dir = button === 'next' ? 1 : -1
      for (const offset of [-0.55, 0.25]) {
        const tip = cx + dir * (offset + 0.55) * s
        g.beginPath()
        g.moveTo(tip, cy)
        g.lineTo(tip - dir * s * 0.8, cy - s * 0.55)
        g.lineTo(tip - dir * s * 0.8, cy + s * 0.55)
        g.closePath()
        g.fill()
      }
      g.fillRect(button === 'next' ? cx + s * 0.85 : cx - s * 1.1, cy - s * 0.55, s * 0.25, s * 1.1)
      return
    }
    case 'stop':
      // ■ over a small eject bar.
      g.fillRect(cx - s * 0.5, cy - s * 0.6, s, s * 0.85)
      g.fillRect(cx - s * 0.5, cy + s * 0.45, s, s * 0.18)
      return
    case 'voldown':
    case 'volup':
      g.fillRect(cx - s * 0.6, cy - s * 0.12, s * 1.2, s * 0.24)
      if (button === 'volup') g.fillRect(cx - s * 0.12, cy - s * 0.6, s * 0.24, s * 1.2)
      return
    case 'disc':
      g.font = font(400, 26, FONT.osd)
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('DISC', cx, cy + 1)
      return
  }
}

function drawButton(g: CanvasRenderingContext2D, button: CdButton, hovered: boolean, pressed: boolean, playing: boolean): void {
  const { x, y, w, h, r } = CD_BUTTONS[button]
  const rubber = g.createLinearGradient(x, y, x, y + h)
  rubber.addColorStop(0, pressed ? '#2c2f36' : hovered ? '#5d626d' : '#4a4e57')
  rubber.addColorStop(1, pressed ? '#16181c' : '#24262c')
  g.beginPath()
  g.roundRect(x + 2, y + 2, w - 4, h - 4, r)
  g.fillStyle = rubber
  g.fill()
  g.lineWidth = 2
  g.strokeStyle = hovered ? 'rgba(255, 220, 170, 0.55)' : 'rgba(0, 0, 0, 0.6)'
  g.stroke()
  drawGlyph(g, button, x + w / 2, y + h / 2, 12, playing, pressed ? '#9da3ad' : '#d9dde3')
}

const BUTTON_LABELS: Readonly<Record<CdButton, string>> = {
  prev: 'PREVIOUS TRACK',
  play: 'PLAY',
  next: 'NEXT TRACK',
  stop: 'STOP / EJECT',
  voldown: 'VOLUME DOWN',
  volup: 'VOLUME UP',
  disc: 'CHANGE DISC',
}

class CdLcdChannel implements Channel {
  readonly id = 'cd/lcd'
  private readonly hooks: CdLcdHooks
  private pressed: { readonly id: CdButton; readonly at: number } | null = null

  constructor(hooks: CdLcdHooks) {
    this.hooks = hooks
  }

  get fps(): number {
    if (this.pressed) return 30
    const { status, error } = this.hooks.view()
    return status === 'playing' || status === 'loading' || error ? 8 : 4
  }

  draw(g: CanvasRenderingContext2D, t: number, ctx: ChannelContext): void {
    const { width, height } = ctx
    const view = this.hooks.view()
    drawPanel(g, width, height)
    drawHeader(g, view, t)
    drawTimes(g, view, t)
    drawVolume(g, view.volume)

    // The scrolling line, one character at a time.
    g.font = font(400, 30, FONT.osd)
    g.fillStyle = INK
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    const visible = Math.max(8, Math.floor((LCD.w - 36) / Math.max(1, g.measureText('M').width)))
    g.save()
    g.beginPath()
    g.rect(LCD.x + 10, LCD.y + 92, LCD.w - 20, 42)
    g.clip()
    g.fillText(scrollWindow(lcdLine(view), visible, ctx.reducedMotion ? 0 : t), LCD.x + 14, LCD.y + 124)
    g.restore()

    const pressed = this.pressed && t - this.pressed.at < PRESS_SECONDS ? this.pressed.id : null
    for (const button of CD_BUTTON_ORDER) {
      drawButton(g, button, ctx.hover === button, pressed === button, view.status === 'playing')
    }
    if (this.pressed && !pressed) this.pressed = null
  }

  hits(): readonly HitRect[] {
    const playing = this.hooks.view().status === 'playing'
    return CD_BUTTON_ORDER.map((button) => ({
      id: button,
      ...CD_BUTTONS[button],
      label: button === 'play' && playing ? 'PAUSE' : BUTTON_LABELS[button],
    }))
  }

  press(id: string, ctx: ChannelContext): void {
    const button = CD_BUTTON_ORDER.find((candidate) => candidate === id)
    if (!button) return
    this.pressed = { id: button, at: ctx.time }
    this.hooks.press(button)
    ctx.invalidate()
  }

  key(key: string, ctx: ChannelContext): boolean {
    const button = cdKeyButton(key)
    if (button) {
      this.press(button, ctx)
      return true
    }
    const digit = Number.parseInt(key, 10)
    if (Number.isInteger(digit) && digit >= 1 && digit <= this.hooks.view().disc.tracks.length) {
      this.hooks.playTrack(digit - 1)
      ctx.invalidate()
      return true
    }
    return false
  }
}

export function createCdLcdChannel(hooks: CdLcdHooks): Channel {
  return new CdLcdChannel(hooks)
}
