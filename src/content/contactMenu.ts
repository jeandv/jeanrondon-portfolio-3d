import { LINKS } from './links'
import { RESUME } from './resume'

/** One row of the PC's BBS contact menu (the HUD hint counts them too). */
export interface MenuLink {
  readonly id: string
  readonly label: string
  readonly href: string
}

/**
 * The BBS menu on #online: the contact links, then the CV. Built here from
 * RESUME so links.ts (the site's own data) stays untouched.
 */
export const CONTACT_MENU: readonly MenuLink[] = [...LINKS, { id: 'cv', label: RESUME.label, href: RESUME.url }]
