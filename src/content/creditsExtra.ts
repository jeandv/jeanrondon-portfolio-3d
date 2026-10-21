import { CREDITS, type Credit } from './credits'

/**
 * Credits for phase 3 (the CD's Joji disc, the wall posters, the tech
 * posters' icons and the landmark in the window), kept apart from
 * credits.ts and merged after it: the card and the HTML layer show
 * ALL_CREDITS. Same rules: plain Latin-1 text, https links only.
 */
export const CREDITS_EXTRA: readonly Credit[] = [
  {
    role: 'Music',
    text: "Joji — streamed from 88rising's official YouTube videos",
    href: 'https://www.youtube.com/@88rising',
  },
  // TODO(Jean): if you drop your own images in src/assets/posters/, credit them here (you need the rights to them).
  { role: 'Posters', text: 'Original fan tributes; names belong to their owners' },
  { role: 'Icons', text: 'Simple Icons (CC0)', href: 'https://simpleicons.org' },
  { role: 'Landmark', text: 'Obelisco de Barquisimeto' },
]

export const ALL_CREDITS: readonly Credit[] = [...CREDITS, ...CREDITS_EXTRA]
