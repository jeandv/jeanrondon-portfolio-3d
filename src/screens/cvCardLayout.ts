import type { HitRect } from './hit'

/**
 * Geometry of the CV index card's two prints, kept free of runtime imports so
 * tests (e2e included) can aim at the OPEN CV button: the wide 5 × 3 in card
 * and the upright phone card (≤ 420 CSS px wide).
 */

/** Wide print (canvas px). */
export const CARD_SIZE = { width: 1000, height: 600 } as const

/** Phones: the same card held upright. */
export const COMPACT_CARD_SIZE = { width: 600, height: 1000 } as const

export type CvPrint = 'wide' | 'compact'

export const CV_BUTTON_ID = 'open'

/** The big OPEN CV button of each print (canvas px, origin top-left). */
export const CV_BUTTONS: Readonly<Record<CvPrint, HitRect>> = {
  wide: { id: CV_BUTTON_ID, x: 230, y: 286, w: 540, h: 96, label: 'OPEN CV' },
  compact: { id: CV_BUTTON_ID, x: 44, y: 388, w: 512, h: 120, label: 'OPEN CV' },
}

export const CV_SIZES: Readonly<Record<CvPrint, { readonly width: number; readonly height: number }>> = {
  wide: CARD_SIZE,
  compact: COMPACT_CARD_SIZE,
}

/** Hit rects of a print (the card only has the button; a click elsewhere files the card away). */
export function cvHits(print: CvPrint): readonly HitRect[] {
  return [CV_BUTTONS[print]]
}

/**
 * Three-native UV (the plane's own: (0,0) bottom-left, v up, unlike a GLB
 * screen's glTF UVs) of the OPEN CV button's centre, for `__screenPointUv('cv_card', u, v)`.
 */
export function cvButtonUv(print: CvPrint): { u: number; v: number } {
  const { x, y, w, h } = CV_BUTTONS[print]
  const { width, height } = CV_SIZES[print]
  return { u: (x + w / 2) / width, v: 1 - (y + h / 2) / height }
}
