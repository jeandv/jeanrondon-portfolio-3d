/**
 * Layout of the CD player's front strip canvas (`cd_display`), kept free of
 * imports so tests (e2e included) can aim at its buttons.
 */

export const CD_LCD_SIZE = { width: 720, height: 160 } as const

export type CdButton = 'prev' | 'play' | 'next'

export interface CdButtonRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Radius of the round rubber button drawn inside the rect. */
  readonly r: number
}

/** Button hit rects (canvas px). */
export const CD_BUTTONS: Readonly<Record<CdButton, CdButtonRect>> = {
  prev: { x: 478, y: 38, w: 70, h: 84, r: 29 },
  play: { x: 552, y: 30, w: 82, h: 100, r: 36 },
  next: { x: 638, y: 38, w: 70, h: 84, r: 29 },
}

/** UV0 (glTF, v down) of a button's centre on the strip. */
export function buttonUv(button: CdButton): { u: number; v: number } {
  const { x, y, w, h } = CD_BUTTONS[button]
  return { u: (x + w / 2) / CD_LCD_SIZE.width, v: (y + h / 2) / CD_LCD_SIZE.height }
}
