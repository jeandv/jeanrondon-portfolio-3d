import { YT_API_URL, type YtNamespace } from './api'

/**
 * Loads the YouTube IFrame API on demand (once): a <script> to
 * https://www.youtube.com/iframe_api that calls `onYouTubeIframeAPIReady`.
 * Never called at boot: only the first PLAY on the Joji disc gets here, so a
 * visitor who never plays it never talks to YouTube (no script, no cookies).
 */

declare global {
  interface Window {
    YT?: YtNamespace & { loaded?: number }
    onYouTubeIframeAPIReady?: () => void
  }
}

/** How long the script may take before the disc reads ERR. */
export const API_TIMEOUT_MS = 15_000

let pending: Promise<YtNamespace> | null = null

export function loadYouTubeApi(timeoutMs = API_TIMEOUT_MS): Promise<YtNamespace> {
  if (pending) return pending
  pending = new Promise<YtNamespace>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('no window'))
      return
    }
    const ready = window.YT
    if (ready?.Player && ready.loaded === 1) {
      resolve(ready)
      return
    }
    const timer = window.setTimeout(() => reject(new Error('the YouTube API timed out')), timeoutMs)
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      window.clearTimeout(timer)
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('the YouTube API loaded without YT.Player'))
    }
    const script = document.createElement('script')
    script.src = YT_API_URL
    script.async = true
    script.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('the YouTube API could not be loaded'))
    }
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    // A failed load (offline, blocked) may be retried on the next PLAY.
    pending = null
    throw error
  })
  return pending
}
