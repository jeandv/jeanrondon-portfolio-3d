import { CREDITS } from '../content/credits'
import { displayHref, isWebLink, LINKS } from '../content/links'
import { PROFILE } from '../content/profile'
import { SITE } from '../content/site'
import type { Tape } from '../content/types'
import { TAPES } from '../content/work'

/*
 * The HTML layer (plan §5.10): prerendered into index.html at build time,
 * rendered client-side in dev. With WebGL it is visually hidden (sr-only) but
 * stays in the accessibility tree; without JS/WebGL it is the readable site.
 * Section ids carry the `s-` prefix so no DOM id equals a route.
 */

function TapeItem({ tape }: { readonly tape: Tape }) {
  return (
    <li className="seo-tape" id={`s-tape-${tape.id}`}>
      <article>
        <h4>
          <a href={`#work/${tape.id}`}>Play tape: {tape.title}</a>
        </h4>
        <p className="seo-meta">
          {tape.years} · {tape.role}
        </p>
        <p>{tape.summary}</p>
        <ul>
          {tape.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <p className="seo-stack">
          <span className="s-sr-only">Stack: </span>
          {tape.stack.join(' · ')}
        </p>
        {tape.url && (
          <p>
            <a href={tape.url} target="_blank" rel="noopener noreferrer">
              {displayHref(tape.url)}
              <span className="s-sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        )}
      </article>
    </li>
  )
}

function TapeList({ heading, tapes }: { readonly heading: string; readonly tapes: readonly Tape[] }) {
  if (tapes.length === 0) return null
  return (
    <>
      <h3>{heading}</h3>
      <ol className="seo-tapes">
        {tapes.map((tape) => (
          <TapeItem key={tape.id} tape={tape} />
        ))}
      </ol>
    </>
  )
}

export function SeoContent() {
  return (
    <div className="seo">
      <section id="s-home" className="seo-section seo-hero" aria-labelledby="s-home-title">
        <h1 id="s-home-title" tabIndex={-1}>
          {PROFILE.name}
        </h1>
        <p className="seo-role">
          {PROFILE.role} · {PROFILE.location}
        </p>
        <p>{SITE.description}</p>
      </section>

      <section id="s-about" className="seo-section" aria-labelledby="s-about-title">
        <h2 id="s-about-title" tabIndex={-1}>
          About
        </h2>
        {PROFILE.bio.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>

      <section id="s-work" className="seo-section" aria-labelledby="s-work-title">
        <h2 id="s-work-title" tabIndex={-1}>
          Work
        </h2>
        <TapeList heading="Companies" tapes={TAPES.filter((tape) => tape.kind === 'company')} />
        <TapeList heading="Projects" tapes={TAPES.filter((tape) => tape.kind === 'project')} />
      </section>

      <section id="s-online" className="seo-section" aria-labelledby="s-online-title">
        <h2 id="s-online-title" tabIndex={-1}>
          Online
        </h2>
        <ul className="seo-links">
          {LINKS.map((link) => (
            <li key={link.id}>
              <a
                href={link.href}
                {...(isWebLink(link.href) ? { target: '_blank', rel: 'me noopener noreferrer' } : {})}
              >
                {link.label}
              </a>{' '}
              <span className="seo-meta">{displayHref(link.href)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="s-credits" className="seo-section seo-credits" aria-labelledby="s-credits-title">
        <h2 id="s-credits-title" tabIndex={-1}>
          Credits
        </h2>
        <dl>
          {CREDITS.map((credit) => (
            <div key={credit.role}>
              <dt>{credit.role}</dt>
              <dd>
                {credit.href ? (
                  <a href={credit.href} target="_blank" rel="noopener noreferrer">
                    {credit.text}
                    <span className="s-sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  credit.text
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
