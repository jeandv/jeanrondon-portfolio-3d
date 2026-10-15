import type { ContactLink } from './types'

// TODO(Jean): real contact links (example.com is a reserved placeholder domain).
export const LINKS: readonly ContactLink[] = [
  { id: 'email', label: 'Email', href: 'mailto:hello@example.com' },
  { id: 'github', label: 'GitHub', href: 'https://github.com/your-user' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/your-user' },
]

/** Short human form of a link: `mailto:a@b.c` → `a@b.c`, `https://www.x.com/y/` → `x.com/y`. */
export function displayHref(href: string): string {
  return href
    .replace(/^mailto:/i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')
}

/** External links (everything but mailto) open in a new tab. */
export function isWebLink(href: string): boolean {
  return /^https?:\/\//i.test(href)
}
