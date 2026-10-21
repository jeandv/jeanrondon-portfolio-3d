import { siJavascript, siNextdotjs, siReact, siTypescript } from 'simple-icons'

/**
 * Brand marks for the tech posters, from Simple Icons (CC0 path data, 24×24
 * viewBox; named imports so the build keeps only these four). Used
 * nominatively: they say which tools the owner works with. Drawn unaltered
 * (no distortion, no recolouring beyond the single-colour marks Simple Icons
 * ships), each with its brand colour.
 */

export interface Mark {
  readonly title: string
  /** Brand colour (sRGB hex, no #). */
  readonly hex: string
  /** SVG path data in a 24×24 box. */
  readonly path: string
}

export const MARKS = {
  typescript: siTypescript,
  javascript: siJavascript,
  react: siReact,
  next: siNextdotjs,
} as const satisfies Record<string, Mark>

export type MarkId = keyof typeof MARKS

/** Side of the marks' viewBox. */
export const MARK_BOX = 24
