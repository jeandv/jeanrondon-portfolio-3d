import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three'
import type { Channel, ChannelContext } from './channel'
import { STATIC_CHANNEL } from './channels/tv/static'
import { screenFontsReady } from './fonts'
import { hitTest, type HitRect } from './hit'

/** Redraw rate while the screen is outside the camera frustum. */
export const OFFSCREEN_FPS = 2
/** Redraw rate of the static transition between channels. */
export const TRANSITION_FPS = 30
/** Default static transition length (ms). */
export const STATIC_MS = 280

export interface ScreenEnv {
  readonly navigate: (hash: string) => void
  readonly openLink: (href: string) => void
}

export interface SwitchOptions {
  readonly transition?: 'static' | 'cut'
  readonly ms?: number
}

export interface CanvasScreenOptions {
  readonly width: number
  readonly height: number
  readonly name: string
  readonly env: ScreenEnv
}

/** Screen texture settings (plan §5.5): sRGB, glTF UVs (flipY=false), no mipmaps. */
export function configureScreenTexture<T extends Texture>(texture: T, name: string): T {
  texture.name = name
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 4
  return texture
}

/** Frames per second a screen should redraw at right now. */
export function effectiveFps(channelFps: number, visible: boolean, transitioning: boolean): number {
  const fps = transitioning ? TRANSITION_FPS : channelFps
  return visible ? fps : Math.min(fps, OFFSCREEN_FPS)
}

/** Whether a redraw is due at `now` (seconds). A small slack absorbs frame jitter. */
export function redrawDue(now: number, lastDraw: number, fps: number): boolean {
  return fps > 0 && now - lastDraw >= 1 / fps - 0.004
}

/**
 * A Canvas2D surface shown on a 3D screen through a CanvasTexture. Redraws
 * only at the channel's fps or when invalidated, drops to 2 fps off-screen,
 * and plays a short static transition between channels.
 */
export class CanvasScreen {
  readonly width: number
  readonly height: number
  readonly canvas: HTMLCanvasElement
  readonly texture: CanvasTexture

  private readonly g: CanvasRenderingContext2D
  private readonly env: ScreenEnv
  private channel: Channel | null = null
  /** `channel` has been told to exit (a switch away is under way). */
  private exited = false
  private pending: Channel | null = null
  private transitionStart = 0
  private transitionEnd = 0
  private enteredAt = 0
  private lastDraw = Number.NEGATIVE_INFINITY
  private now = 0
  private dirty = true
  private hover: string | null = null
  private visible = true
  private reducedMotion = false
  private draws = 0

  constructor({ width, height, name, env }: CanvasScreenOptions) {
    this.width = width
    this.height = height
    this.env = env
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    const g = this.canvas.getContext('2d')
    if (!g) throw new Error(`[screens] no 2D context for "${name}"`)
    this.g = g
    this.texture = configureScreenTexture(new CanvasTexture(this.canvas), `screen_${name}`)
  }

  /** The channel on screen (or the one waiting behind the static). */
  get channelId(): string | null {
    return (this.pending ?? this.channel)?.id ?? null
  }

  /** Redraws so far (0 = the canvas is still blank). */
  get drawCount(): number {
    return this.draws
  }

  setVisible(visible: boolean): void {
    this.visible = visible
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (reducedMotion !== this.reducedMotion) {
      this.reducedMotion = reducedMotion
      this.dirty = true
    }
  }

  invalidate(): void {
    this.dirty = true
  }

  /** Changes channel; the static transition is skipped with reduced motion or on the first channel. */
  switchTo(channel: Channel, { transition = 'static', ms = STATIC_MS }: SwitchOptions = {}): void {
    if (this.channelId === channel.id) return
    // The outgoing channel stops right away, before the static covers it.
    this.exitCurrent()
    if (transition === 'static' && ms > 0 && this.channel && !this.reducedMotion) {
      this.pending = channel
      this.transitionStart = this.now
      this.transitionEnd = this.now + ms / 1000
    } else {
      this.enter(channel)
    }
    this.dirty = true
  }

  /** Per-frame tick (`now` in seconds). Returns true when the texture changed. */
  update(now: number): boolean {
    this.now = now
    if (this.pending && now >= this.transitionEnd) this.enter(this.pending)
    const channel = this.channel
    if (!channel) return false
    const transitioning = this.pending !== null
    const fps = effectiveFps(channel.fps, this.visible, transitioning)
    if (!this.dirty && !redrawDue(now, this.lastDraw, fps)) return false
    // Never draw with a fallback font (the texture would bake it in).
    if (!screenFontsReady()) return false

    const g = this.g
    g.save()
    if (transitioning) {
      STATIC_CHANNEL.draw(g, now - this.transitionStart, this.context())
    } else {
      channel.draw(g, now - this.enteredAt, this.context())
    }
    g.restore()
    this.texture.needsUpdate = true
    this.lastDraw = now
    this.dirty = false
    this.draws++
    return true
  }

  /** Hit rect at canvas pixel (x, y); none during transitions. */
  hitAt(x: number, y: number): HitRect | null {
    const channel = this.pending ? null : this.channel
    if (!channel?.hits) return null
    return hitTest(channel.hits(this.context()), x, y)
  }

  setHover(id: string | null): void {
    if (id === this.hover) return
    this.hover = id
    this.dirty = true
  }

  press(id: string): void {
    if (this.pending || !this.channel?.press) return
    this.channel.press(id, this.context())
    this.dirty = true
  }

  /** Keyboard input for the current channel (ignored mid-transition). */
  key(key: string): boolean {
    if (this.pending || !this.channel?.key) return false
    const used = this.channel.key(key, this.context())
    if (used) this.dirty = true
    return used
  }

  dispose(): void {
    this.exitCurrent()
    this.texture.dispose()
  }

  private exitCurrent(): void {
    if (!this.channel || this.exited) return
    this.exited = true
    this.channel.exit?.()
  }

  private enter(channel: Channel): void {
    this.channel = channel
    this.exited = false
    this.pending = null
    this.enteredAt = this.now
    this.hover = null
    channel.enter?.(this.context())
  }

  private context(): ChannelContext {
    return {
      width: this.width,
      height: this.height,
      reducedMotion: this.reducedMotion,
      hover: this.hover,
      time: this.now - this.enteredAt,
      invalidate: () => this.invalidate(),
      navigate: this.env.navigate,
      openLink: this.env.openLink,
    }
  }
}
