import { createRoot } from 'react-dom/client'
import { SITE } from '../content/site'
import { SeoContent } from './SeoContent'

/**
 * Dev (or a build that skipped the prerender): renders the SEO layer into an
 * empty `#seo` and sets the title the `<!--head-->` slot would have provided.
 */
export function mountSeo(container: HTMLElement): void {
  if (!document.title) document.title = SITE.title
  createRoot(container).render(<SeoContent />)
}
