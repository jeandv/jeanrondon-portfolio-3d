/** Clickable region of a channel, in canvas pixels (origin top-left). */
export interface HitRect {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Tooltip text while hovered. */
  readonly label?: string
}

export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Mesh UV → canvas pixels. Screen meshes follow glTF ((0,0) = top-left, and
 * their CanvasTextures use flipY=false), so v maps straight to rows. Pass
 * `flipY` for three-native geometry ((0,0) = bottom-left).
 */
export function uvToCanvas(uv: Point, width: number, height: number, flipY = false): Point {
  return { x: uv.x * width, y: (flipY ? 1 - uv.y : uv.y) * height }
}

export function containsPoint(rect: HitRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

/** Topmost rect under the point (later rects are drawn on top), or null. */
export function hitTest(rects: readonly HitRect[], x: number, y: number): HitRect | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const rect = rects[i]
    if (rect && containsPoint(rect, x, y)) return rect
  }
  return null
}
