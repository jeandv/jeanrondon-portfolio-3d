/**
 * Posters on the room's walls: three "tech" posters (the stack, Swiss style,
 * drawn around the Simple Icons marks) and five fan tributes (original art
 * drawn in code: no official artwork, covers, logos or photos). Hover shows
 * "TITLE — SUBTITLE"; a click does nothing (yet).
 *
 * Your own image: drop `src/assets/posters/<id>.jpg` (or .jpeg / .png / .webp)
 * and it replaces that poster's generated art, cover-cropped into its slot.
 * You are responsible for the rights to any image you add.
 *
 * Slots are spots on the greybox walls (src/three/objects/posters/layout.ts);
 * a Blender plane `poster_<id>` overrides a slot (docs/BLENDER.md).
 * Text is drawn with the screen fonts: keep to Latin-1 + common punctuation.
 */

export interface PaperSize {
  /** Metres. */
  readonly width: number
  readonly height: number
}

/** Paper sizes (portrait unless noted). */
export const PAPER = {
  A2: { width: 0.42, height: 0.594 },
  A3: { width: 0.297, height: 0.42 },
  /** A small print. */
  small: { width: 0.24, height: 0.32 },
  /** A strip for the narrow wall under the window sill (landscape). */
  banner: { width: 0.26, height: 0.12 },
  /** Landscape print. */
  landscape: { width: 0.48, height: 0.34 },
} as const satisfies Record<string, PaperSize>

/** Named spots on the walls (src/three/objects/posters/layout.ts places them). */
export type WallSlot =
  | 'back-left'
  | 'back-right-upper'
  | 'back-right-lower'
  | 'under-sill'
  | 'under-clock'
  | 'left-wall'
  | 'right-wall-near'
  | 'right-wall-far'

/** sRGB colours the art is drawn with. */
export interface PosterPalette {
  readonly paper: string
  readonly ink: string
  readonly accent: string
  readonly accent2: string
}

/** Which mark a tech poster is built around (Simple Icons, CC0). */
export type TechMark = 'typescript' | 'javascript' | 'react-next'
/** Which original composition a tribute poster draws. */
export type TributeArt = 'berserk' | 'vagabond' | 'joji' | 'radiohead' | 'nirvana'

interface PosterBase {
  /** Unique, kebab-case; also the override image's file name. */
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly palette: PosterPalette
  readonly slot: WallSlot
  readonly size: PaperSize
}

export interface TechPoster extends PosterBase {
  readonly kind: 'tech'
  readonly mark: TechMark
  /** Small line under the title, e.g. "since 2019". */
  readonly since: string
}

export interface TributePoster extends PosterBase {
  readonly kind: 'tribute'
  readonly art: TributeArt
}

export type Poster = TechPoster | TributePoster

export const POSTERS: readonly Poster[] = [
  {
    id: 'typescript',
    kind: 'tech',
    mark: 'typescript',
    title: 'TypeScript',
    subtitle: 'Typed JavaScript',
    // TODO(Jean): the year you started with TypeScript.
    since: 'since 20XX',
    palette: { paper: '#3178c6', ink: '#ffffff', accent: '#0d2a4d', accent2: '#9cc2ec' },
    slot: 'back-right-upper',
    size: PAPER.A3,
  },
  {
    id: 'javascript',
    kind: 'tech',
    mark: 'javascript',
    title: 'JavaScript',
    // TODO(Jean): the year you started with JavaScript.
    since: 'since 20XX',
    palette: { paper: '#f7df1e', ink: '#111111', accent: '#323330', accent2: '#ffffff' },
    slot: 'under-sill',
    size: PAPER.banner,
  },
  {
    id: 'react-next',
    kind: 'tech',
    mark: 'react-next',
    title: 'React / Next.js',
    subtitle: 'UI, the component way',
    // TODO(Jean): the year you started with React / Next.js.
    since: 'since 20XX',
    palette: { paper: '#20232a', ink: '#ffffff', accent: '#61dafb', accent2: '#3a3f4b' },
    slot: 'back-right-lower',
    size: PAPER.small,
  },
  {
    id: 'berserk',
    kind: 'tribute',
    art: 'berserk',
    title: 'Berserk',
    subtitle: 'Kentaro Miura',
    palette: { paper: '#140405', ink: '#efe2cf', accent: '#b3121b', accent2: '#ff4a2e' },
    slot: 'back-left',
    size: PAPER.A2,
  },
  {
    id: 'vagabond',
    kind: 'tribute',
    art: 'vagabond',
    title: 'Vagabond',
    subtitle: 'Takehiko Inoue',
    palette: { paper: '#efe6d2', ink: '#16130f', accent: '#b8322a', accent2: '#8a7f6c' },
    slot: 'left-wall',
    size: PAPER.A2,
  },
  {
    // TODO(Jean): pick the Joji mood you like (palette) or drop in your own print (see above).
    id: 'joji',
    kind: 'tribute',
    art: 'joji',
    title: 'Joji',
    subtitle: 'Lo-fi nights',
    palette: { paper: '#f2c9b8', ink: '#3b3352', accent: '#a9a3d6', accent2: '#fff4e6' },
    slot: 'under-clock',
    size: PAPER.landscape,
  },
  {
    id: 'radiohead',
    kind: 'tribute',
    art: 'radiohead',
    title: 'Radiohead',
    subtitle: 'Signal / noise',
    palette: { paper: '#08111f', ink: '#e8f1ff', accent: '#4f8dff', accent2: '#ff3b5c' },
    slot: 'right-wall-near',
    size: PAPER.A2,
  },
  {
    id: 'nirvana',
    kind: 'tribute',
    art: 'nirvana',
    title: 'Nirvana',
    subtitle: 'Seattle, 1991',
    palette: { paper: '#e9e4d6', ink: '#141414', accent: '#2c6fa8', accent2: '#8d8778' },
    slot: 'right-wall-far',
    size: PAPER.A2,
  },
]

/** Tooltip text: "BERSERK — KENTARO MIURA". */
export function posterLabel(poster: Poster): string {
  return (poster.subtitle ? `${poster.title} — ${poster.subtitle}` : poster.title).toUpperCase()
}
