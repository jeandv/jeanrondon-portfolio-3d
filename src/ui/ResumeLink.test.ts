import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RESUME } from '../content/resume'
import { ResumeLink } from './ResumeLink'

describe('CV pill', () => {
  const html = renderToStaticMarkup(createElement(ResumeLink))

  it('is a real link to the CV that opens in a new tab without an opener', () => {
    expect(html.startsWith('<a ')).toBe(true)
    expect(html).toContain(`href="${RESUME.url}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('looks like the other pills, says CV, and names itself for screen readers', () => {
    expect(html).toContain('class="s-pill"')
    expect(html).toContain("aria-label=\"Open Jean Rondón&#x27;s CV (opens in a new tab)\"")
    expect(html).toMatch(/>CV<svg [^>]*aria-hidden="true"/)
  })
})
