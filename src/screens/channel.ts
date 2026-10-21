import type { HitRect } from './hit'

/** What a channel can read and do while drawing or handling input. */
export interface ChannelContext {
  readonly width: number
  readonly height: number
  readonly reducedMotion: boolean
  /** Id of the hit rect under the pointer, or null. */
  readonly hover: string | null
  /** Seconds since the channel was entered (same clock as `draw`'s `t`). */
  readonly time: number
  /** Redraw on the next frame (state changed outside the fps tick). */
  invalidate(): void
  /** Hash navigation through the store (e.g. `#work/<id>`). */
  navigate(hash: string): void
  /** Opens an external link (new tab with noopener; mailto in place). */
  openLink(href: string): void
}

/**
 * One "channel" drawn on a CanvasScreen (plan §5.5):
 * `interface Channel { id; fps; enter?; draw(g,t,ctx); key?; hits? }`.
 * `fps` may be a getter: channels speed up while animating and idle after.
 */
export interface Channel {
  /** Stable identity; switching to the same id is a no-op. */
  readonly id: string
  /** Redraw rate while on screen; 0 = only when invalidated. */
  readonly fps: number
  enter?(ctx: ChannelContext): void
  /** The screen is switching away (or going away): stop anything still running (e.g. a sound). */
  exit?(): void
  draw(g: CanvasRenderingContext2D, t: number, ctx: ChannelContext): void
  /** Keyboard input (`KeyboardEvent.key`); true when the key was used. */
  key?(key: string, ctx: ChannelContext): boolean
  /** Clickable regions in canvas pixels. */
  hits?(ctx: ChannelContext): readonly HitRect[]
  /** Activates a hit rect (click or tap). */
  press?(id: string, ctx: ChannelContext): void
}
