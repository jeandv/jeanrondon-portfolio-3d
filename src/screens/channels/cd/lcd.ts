import { TRACK_SECONDS } from '../../../audio/music/tracks'
import { MUSIC } from '../../../content/music'
import { cursorAt, type CdState } from '../../../three/objects/cd/player'
import type { Channel, ChannelContext } from '../../channel'
import { blinkOn, playGlyph } from '../../draw'
import { font, FONT } from '../../fonts'
import type { HitRect } from '../../hit'
import { drawSegments, formatTrackTime, segmentCells, type SegmentStyle } from '../../sevenSeg'

/**
 * The CD player's front strip (`cd_display`, 720×160): a backlit LCD with the
 * track number and the elapsed time in seven segments, a play / pause / stop
 * icon, REP and MUTE flags and the track title scrolling a character at a
 * time (VT323), plus the three rubber buttons (previous, play/pause, next)
 * as hit rects. Opening the lid reads OPEn.
 */

export const CD_LCD_SIZE = { width: 720, height: 160 } as const

export type CdButton = 'prev' | 'play' | 'next'

/** Button hit rects (canvas px): e2e and the UV helper aim at their centres. */
export const CD_BUTTONS: Readonly<Record<CdButton, { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }>> = {
  prev: { x: 478, y: 38, w: 70, h: 84, r: 29 },
  play: { x: 552, y: 30, w: 82, h: 100, r: 36 },
  next: { x: 638, y: 38, w: 70, h: 84, r: 29 },
}

const LCD = { x: 14, y: 14, w: 448, h: 132 } as const
const INK = '#132a1c'
const GHOST = 'rgba(19, 42, 28, 0.07)'
const SEGMENTS: SegmentStyle = { on: INK, off: GHOST, thickness: 0.2, slant: 0.1 }
/** Title scroll speed (characters per second, LCD style). */
export const SCROLL_CPS = 4
/** Seconds a pressed button shows pressed. */
const PRESS_SECONDS = 0.14

export interface CdLcdView {
  readonly cd: CdState
  /** SOUND OFF: the MUTE flag. */
  readonly muted: boolean
}

export interface CdLcdHooks {
  readonly view: () => CdLcdView
  /** The music clock (s). */
  readonly now: () => number
  readonly press: (button: CdButton) => void
  /** Digit keys pick a track (0-based). */
  readonly playTrack: (index: number) => void
}

/** The line that scrolls: the track (number, title, artist) or, stopped, the disc. */
export function lcdLine(cd: CdState, track: number): string {
  const title = MUSIC.tracks[track]?.title ?? `TRACK ${track + 1}`
  if (cd.lid === 'open') return 'OPEN - INSERT DISC'
  if (cd.status === 'stopped') return `${MUSIC.title} - ${MUSIC.tracks.length} TRACKS`.toUpperCase()
  return `${String(track + 1).padStart(2, '0')} ${title} - ${MUSIC.artist}`.toUpperCase()
}

/** The visible window of a scrolling line at time `t` (whole characters, wrapping with a gap). */
export function scrollWindow(text: string, visible: number, t: number): string {
  if (text.length <= visible) return text
  const loop = `${text}    `
  const offset = Math.floor(t * SCROLL_CPS) % loop.length
  return (loop + loop).slice(offset, offset + visible)
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

function drawPanel(g: CanvasRenderingContext2D, width: number, height: number): void {
  const panel = g.createLinearGradient(0, 0, 0, height)
  panel.addColorStop(0, '#2a2d34')
  panel.addColorStop(1, '#17191d')
  g.fillStyle = panel
  g.fillRect(0, 0, width, height)
  // Backlit LCD window with a soft bezel.
  roundRect(g, LCD.x - 4, LCD.y - 4, LCD.w + 8, LCD.h + 8, 12)
  g.fillStyle = '#0c0d10'
  g.fill()
  const glass = g.createLinearGradient(0, LCD.y, 0, LCD.y + LCD.h)
  glass.addColorStop(0, '#b4e0aa')
  glass.addColorStop(1, '#8fc78e')
  roundRect(g, LCD.x, LCD.y, LCD.w, LCD.h, 8)
  g.fillStyle = glass
  g.fill()
}

function drawStatus(g: CanvasRenderingContext2D, view: CdLcdView, t: number): void {
  const { cd } = view
  const x = 370
  const y = 52
  g.fillStyle = INK
  if (cd.status === 'playing') {
    playGlyph(g, x, y, 26, INK)
  } else if (cd.status === 'paused') {
    if (blinkOn(t, 1)) {
      g.fillRect(x, y - 13, 8, 26)
      g.fillRect(x + 14, y - 13, 8, 26)
    }
  } else {
    g.fillRect(x, y - 11, 22, 22)
  }
  g.font = font(400, 20, FONT.osd)
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillText('REP', 404, 46)
  g.fillStyle = view.muted ? INK : GHOST
  g.fillText('MUTE', 404, 68)
}

function drawButton(g: CanvasRenderingContext2D, button: CdButton, hovered: boolean, pressed: boolean, playing: boolean): void {
  const { x, y, w, h, r } = CD_BUTTONS[button]
  const cx = x + w / 2
  const cy = y + h / 2
  const rubber = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r)
  rubber.addColorStop(0, pressed ? '#2c2f36' : hovered ? '#5d626d' : '#4a4e57')
  rubber.addColorStop(1, pressed ? '#16181c' : '#24262c')
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fillStyle = rubber
  g.fill()
  g.lineWidth = 2
  g.strokeStyle = hovered ? 'rgba(255, 220, 170, 0.55)' : 'rgba(0, 0, 0, 0.6)'
  g.stroke()
  const ink = pressed ? '#9da3ad' : '#d9dde3'
  g.fillStyle = ink
  const s = r * 0.42
  if (button === 'play') {
    // ▶❚❚
    playGlyph(g, cx - s * 1.05, cy, s * 1.2, ink)
    g.fillRect(cx + s * 0.25, cy - s * 0.55, s * 0.3, s * 1.1)
    g.fillRect(cx + s * 0.75, cy - s * 0.55, s * 0.3, s * 1.1)
    if (playing) {
      g.fillStyle = '#7dff9a'
      g.beginPath()
      g.arc(cx, cy + r * 0.68, 3, 0, Math.PI * 2)
      g.fill()
    }
    return
  }
  // |◀◀ and ▶▶|
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
    return this.hooks.view().cd.status === 'playing' ? 8 : 4
  }

  draw(g: CanvasRenderingContext2D, t: number, ctx: ChannelContext): void {
    const { width, height } = ctx
    const view = this.hooks.view()
    const { cd } = view
    const cursor = cursorAt(cd, TRACK_SECONDS, this.hooks.now())
    drawPanel(g, width, height)

    g.fillStyle = INK
    g.font = font(400, 20, FONT.osd)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    g.fillText('TRACK', 30, 40)
    g.fillText(cd.lid === 'open' ? '' : 'TIME', 150, 40)
    drawSegments(g, segmentCells(String(cursor.track + 1).padStart(2, '0'), 2), 30, 46, 28, 50, 38, SEGMENTS)

    if (cd.lid === 'open') {
      drawSegments(g, segmentCells('OPEn', 4), 150, 46, 28, 50, 42, SEGMENTS)
    } else {
      const [minutes = '0', seconds = '00'] = formatTrackTime(Math.max(0, cursor.position)).split(':')
      const showTime = cd.status !== 'paused' || blinkOn(t, 1)
      const style = showTime ? SEGMENTS : { ...SEGMENTS, on: GHOST }
      drawSegments(g, segmentCells(minutes, 2), 150, 46, 28, 50, 38, style)
      g.fillStyle = showTime ? INK : GHOST
      g.fillRect(232, 58, 7, 7)
      g.fillRect(232, 80, 7, 7)
      drawSegments(g, segmentCells(seconds, 2), 250, 46, 28, 50, 38, style)
    }
    drawStatus(g, view, t)

    // The scrolling line, one character at a time.
    g.font = font(400, 30, FONT.osd)
    g.fillStyle = INK
    const visible = Math.max(8, Math.floor((LCD.w - 36) / Math.max(1, g.measureText('M').width)))
    g.save()
    g.beginPath()
    g.rect(LCD.x + 10, LCD.y + 90, LCD.w - 20, 40)
    g.clip()
    g.fillText(scrollWindow(lcdLine(cd, cursor.track), visible, ctx.reducedMotion ? 0 : t), LCD.x + 16, LCD.y + 120)
    g.restore()

    const pressed = this.pressed && t - this.pressed.at < PRESS_SECONDS ? this.pressed.id : null
    for (const button of ['prev', 'play', 'next'] as const) {
      drawButton(g, button, ctx.hover === button, pressed === button, cd.status === 'playing')
    }
    if (this.pressed && !pressed) this.pressed = null
  }

  hits(): readonly HitRect[] {
    const playing = this.hooks.view().cd.status === 'playing'
    return [
      { id: 'prev', ...CD_BUTTONS.prev, label: 'PREVIOUS TRACK' },
      { id: 'play', ...CD_BUTTONS.play, label: playing ? 'PAUSE' : 'PLAY' },
      { id: 'next', ...CD_BUTTONS.next, label: 'NEXT TRACK' },
    ]
  }

  press(id: string, ctx: ChannelContext): void {
    if (id !== 'prev' && id !== 'play' && id !== 'next') return
    this.pressed = { id, at: ctx.time }
    this.hooks.press(id)
    ctx.invalidate()
  }

  key(key: string, ctx: ChannelContext): boolean {
    const button: CdButton | null =
      key === ' ' || key === 'Enter'
        ? 'play'
        : key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown'
          ? 'next'
          : key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp'
            ? 'prev'
            : null
    if (button) {
      this.press(button, ctx)
      return true
    }
    const digit = Number.parseInt(key, 10)
    if (Number.isInteger(digit) && digit >= 1 && digit <= MUSIC.tracks.length) {
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
