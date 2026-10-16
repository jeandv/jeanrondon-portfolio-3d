/**
 * Prerender (plan §5.10, last step of `npm run build`): fills the slots of
 * dist/index.html with the SEO layer rendered from src/content.
 *   <!--head-->     → title, description, canonical, Open Graph, Twitter, JSON-LD
 *   <!--seo-->      → SeoContent (h1, bio, tapes, contact) inside #seo
 *   dist/sitemap.xml → the canonical root from SITE.url (src/content/site.ts)
 *   dist/robots.txt  → public/robots.txt + an absolute `Sitemap:` line
 * Expects `vite build` (dist/) and `vite build --ssr src/seo/entry-server.tsx --outDir dist-ssr`.
 */
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')
const TEMPLATE = resolve(DIST, 'index.html')
const SITEMAP = resolve(DIST, 'sitemap.xml')
const ROBOTS = resolve(DIST, 'robots.txt')
const SSR_CANDIDATES = ['dist-ssr/entry-server.js', 'dist-ssr/entry-server.mjs'].map((file) => resolve(ROOT, file))

const SLOTS = { head: '<!--head-->', body: '<!--seo-->' }

async function findEntry() {
  for (const file of SSR_CANDIDATES) {
    try {
      await access(file)
      return file
    } catch {
      // try the next name
    }
  }
  throw new Error(`SSR entry not found (looked for ${SSR_CANDIDATES.map((f) => relative(ROOT, f)).join(', ')})`)
}

/** Pure slot filling (function replacers so `$` in content is never a pattern). */
export function fillTemplate(html, { lang, head, body }) {
  for (const slot of Object.values(SLOTS)) {
    if (!html.includes(slot)) throw new Error(`index.html is missing the ${slot} slot`)
  }
  return html
    .replace(SLOTS.head, () => head)
    .replace(SLOTS.body, () => body)
    .replace(/<html lang="[^"]*">/, () => `<html lang="${lang}">`)
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return 'User-agent: *\nAllow: /\n'
  }
}

async function main() {
  const entry = await findEntry()
  const { render } = await import(pathToFileURL(entry).href)
  const result = render()
  const html = fillTemplate(await readFile(TEMPLATE, 'utf8'), result)
  await writeFile(TEMPLATE, html)
  await writeFile(SITEMAP, result.sitemap)
  await writeFile(ROBOTS, result.robots(await readOptional(ROBOTS)))
  const kib = (Buffer.byteLength(result.body) / 1024).toFixed(1)
  console.log(`[prerender] ${relative(ROOT, TEMPLATE)}: head + SEO layer (${kib} KiB) from ${relative(ROOT, entry)}`)
  console.log(`[prerender] ${relative(ROOT, SITEMAP)} + ${relative(ROOT, ROBOTS)} for ${result.url}`)
  if (result.placeholderUrl) {
    console.warn(`[prerender] WARNING: SITE.url is still the placeholder ${result.url} (src/content/site.ts);`)
    console.warn('[prerender]          canonical, Open Graph, JSON-LD and sitemap.xml point there until it is set.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
