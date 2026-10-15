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
  /** Revealed one by one on the TV. */
  readonly bullets: readonly string[]
  /** Shown as chips on the TV and as a list in the SEO layer. */
  readonly stack: readonly string[]
  /** Optional public link (https), opened from the TV with Enter or a click. */
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
  /** `mailto:` or `https:` only. */
  readonly href: string
}

export interface SiteMeta {
  readonly title: string
  readonly description: string
  /** Production origin (absolute, https), used for canonical/OG URLs. */
  readonly url: string
  /** BCP 47 language tag for `<html lang>`. */
  readonly locale: string
  /** Open Graph image path (1200×630), relative to `url`. */
  readonly ogImage: string
  readonly ogImageAlt: string
}
