/** Single source of truth for everything the site shows (screens, tooltips, SEO layer). */

export type TapeKind = 'company' | 'project'

/** One VHS tape on the shelf = one company or project ("channel"). */
export interface Tape {
  /** URL-safe slug used in `#work/<id>`. */
  readonly id: string
  /** Physical slot on the shelf (1–8), maps to the GLB node `tape_0N`. */
  readonly slot: number
  readonly kind: TapeKind
  readonly title: string
  readonly years: string
  readonly role: string
  readonly summary: string
  readonly bullets: readonly string[]
  readonly stack: readonly string[]
  readonly url?: string
}

export interface Profile {
  readonly name: string
  readonly role: string
  readonly location: string
  /** Paragraphs shown on the PC pager (About). */
  readonly bio: readonly string[]
  readonly photoAlt: string
}

export type LinkId = 'email' | 'github' | 'linkedin'

export interface ContactLink {
  readonly id: LinkId
  readonly label: string
  readonly href: string
}

export interface SiteMeta {
  readonly title: string
  readonly description: string
  readonly url: string
  readonly locale: string
}
