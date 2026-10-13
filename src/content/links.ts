import type { ContactLink } from './types'

// TODO(Jean): real contact links (example.com is a reserved placeholder domain).
export const LINKS: readonly ContactLink[] = [
  { id: 'email', label: 'Email', href: 'mailto:hello@example.com' },
  { id: 'github', label: 'GitHub', href: 'https://github.com/your-user' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/your-user' },
]
