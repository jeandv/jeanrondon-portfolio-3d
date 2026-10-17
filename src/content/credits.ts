import { PROFILE } from './profile'

/**
 * Credits: the index card that floats up from the rolodex (CREDITS pill or a
 * click on the rolodex) and the "Credits" section of the HTML layer. Plain
 * text the screen fonts cover (Latin-1 + common punctuation).
 */
export interface Credit {
  /** Short heading on the card (drawn upper-case). */
  readonly role: string
  readonly text: string
  /** Optional link (the HTML layer links it; the card just prints the text). */
  readonly href?: string
}

export const CREDITS: readonly Credit[] = [
  { role: 'Design & code', text: PROFILE.name },
  {
    role: 'Inspiration',
    text: "Felix Rieseberg's room (felixrieseberg.com)",
    href: 'https://felixrieseberg.com',
  },
  // TODO(Jean): once the Blender scene ships, list the Poly Haven models used (all CC0),
  // e.g. "Television_01, desk_lamp_arm_01 ... by Poly Haven (CC0)", with a link to polyhaven.com.
  { role: '3D', text: 'Greybox room (placeholder until the Blender scene ships)' },
  // TODO(Jean): add any other typeface you bring in (and its licence).
  { role: 'Type', text: 'Archivo, VT323, Caveat, JetBrains Mono, Courier Prime (SIL OFL)' },
  { role: 'Built with', text: 'React Three Fiber, three.js, drei, postprocessing, Vite' },
  // TODO(Jean): credit any recorded sound you add later (none so far: every sound is generated).
  { role: 'Sound', text: 'Synthesized with the Web Audio API' },
]
