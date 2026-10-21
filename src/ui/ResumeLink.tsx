import { RESUME } from '../content/resume'
import { PROFILE } from '../content/profile'

/**
 * CV pill (bottom right, beside SOUND): a real link to the CV in a new tab
 * (the page sends X-Frame-Options: DENY, so it cannot be framed). The ↗ is an
 * inline SVG: the UI face has no such glyph.
 */
export function ResumeLink() {
  return (
    <a
      className="s-pill"
      href={RESUME.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${PROFILE.name}'s CV (opens in a new tab)`}
    >
      {RESUME.label}
      <svg className="s-pill-icon" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
        <path d="M1.5 8.5 8.5 1.5M3 1.5h5.5V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </a>
  )
}
