/**
 * Layout of the CD player's front strip canvas (`cd_display`), kept free of
 * imports so tests (e2e included) can aim at its buttons: the LCD on the
 * left, two rows of rubber keys on the right (transport on top; volume and
 * the disc swap below).
 */

export const CD_LCD_SIZE = { width: 720, height: 160 } as const

export type CdButton = 'prev' | 'play' | 'next' | 'stop' | 'voldown' | 'volup' | 'disc'

export const CD_BUTTON_ORDER: readonly CdButton[] = ['prev', 'play', 'next', 'stop', 'voldown', 'volup', 'disc']

export interface CdButtonRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Corner radius of the rubber key drawn inside the rect. */
  readonly r: number
}

const KEY = { w: 56, h: 64, gap: 6, left: 466, top: 12 } as const

const key = (column: number, row: number, span = 1): CdButtonRect => ({
  x: KEY.left + column * (KEY.w + KEY.gap),
  y: KEY.top + row * (KEY.h + KEY.gap),
  w: KEY.w * span + KEY.gap * (span - 1),
  h: KEY.h,
  r: 12,
})

/** Button hit rects (canvas px). */
export const CD_BUTTONS: Readonly<Record<CdButton, CdButtonRect>> = {
  prev: key(0, 0),
  play: key(1, 0),
  next: key(2, 0),
  stop: key(3, 0),
  voldown: key(0, 1),
  volup: key(1, 1),
  disc: key(2, 1, 2),
}

/** UV0 (glTF, v down) of a button's centre on the strip. */
export function buttonUv(button: CdButton): { u: number; v: number } {
  const { x, y, w, h } = CD_BUTTONS[button]
  return { u: (x + w / 2) / CD_LCD_SIZE.width, v: (y + h / 2) / CD_LCD_SIZE.height }
}
