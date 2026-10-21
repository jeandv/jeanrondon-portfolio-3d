import { useEffect, useRef } from 'react'
import { youtube } from '../audio/cdDeck'
import { sfx } from '../audio/sfx'
import { JOJI_PLAYLIST } from '../content/playlist'
import { useStore } from '../state/store'

interface MonitorProps {
  readonly track: number
}

function eject(): void {
  sfx('click')
  youtube.stop()
}

/**
 * The portable monitor the YouTube player lives in (bottom left, above the
 * hint bar). Mounted only while the Joji disc is loading / playing / paused:
 * the player is always visible (≥ 200 × 200 CSS px), never covered, with the
 * track, a "via YouTube" credit and × (eject: stops the video and removes
 * the player).
 */
function Monitor({ track }: MonitorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    youtube.attach(host)
    return () => youtube.detach(host)
  }, [])
  const title = JOJI_PLAYLIST.tracks[track]?.title ?? ''
  return (
    <section className="s-miniplayer" aria-label="YouTube player">
      <p className="s-miniplayer-title" aria-live="polite">
        {JOJI_PLAYLIST.artist} — {title}
      </p>
      <div className="s-miniplayer-screen" ref={hostRef} data-testid="youtube-host" />
      <div className="s-miniplayer-foot">
        <span className="s-miniplayer-via">via YouTube · {JOJI_PLAYLIST.source.replace(' (YouTube)', '')}</span>
        <button type="button" className="s-miniplayer-eject" aria-label="Stop and remove the YouTube player" title="Eject" onClick={eject}>
          ×
        </button>
      </div>
    </section>
  )
}

/** Shown while the Joji disc's YouTube player is in use (src/audio/youtube/adapter.ts). */
export function MiniPlayer() {
  const status = useStore((state) => state.yt.status)
  const track = useStore((state) => state.yt.track)
  return status === 'stopped' ? null : <Monitor track={track} />
}
