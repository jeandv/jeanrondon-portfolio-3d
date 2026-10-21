/**
 * The slice of the YouTube IFrame Player API the CD player uses
 * (https://developers.google.com/youtube/iframe_api_reference), typed here so
 * the adapter can run against a fake in tests and e2e.
 */

/** YT.PlayerState. */
export const YT_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const

/**
 * onError codes: 2 bad parameter, 5 HTML5 player error, 100 not found /
 * private, 101 and 150 embedding not allowed (153: a missing referrer / origin).
 */
export const YT_ERRORS: readonly number[] = [2, 5, 100, 101, 150, 153]

export interface YtPlayerLike {
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  loadVideoById(videoId: string, startSeconds?: number): void
  cueVideoById(videoId: string, startSeconds?: number): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  setVolume(volume: number): void
  mute(): void
  unMute(): void
  destroy(): void
}

export interface YtEvent {
  readonly target: YtPlayerLike
  readonly data?: number
}

export interface YtPlayerOptions {
  readonly host?: string
  readonly width?: number | string
  readonly height?: number | string
  readonly videoId?: string
  readonly playerVars?: Readonly<Record<string, string | number>>
  readonly events?: {
    readonly onReady?: (event: YtEvent) => void
    readonly onStateChange?: (event: YtEvent) => void
    readonly onError?: (event: YtEvent) => void
  }
}

export interface YtNamespace {
  readonly Player: new (element: HTMLElement | string, options: YtPlayerOptions) => YtPlayerLike
}

/** Privacy-enhanced embed host: no YouTube cookies until a video plays. */
export const YT_HOST = 'https://www.youtube-nocookie.com'
/** The API script (only requested when the visitor first plays the Joji disc). */
export const YT_API_URL = 'https://www.youtube.com/iframe_api'

/**
 * Player parameters still honoured by the embed (checked against the IFrame
 * API docs): no controls (the CD player is the remote), inline on iOS,
 * related videos from the same channel only, the page's origin for the JS
 * API, and the player's own keyboard shortcuts off (the CD keys own the
 * keyboard). `modestbranding` is left out: deprecated since 2023, it has no
 * effect any more.
 */
export function playerVars(origin: string): Readonly<Record<string, string | number>> {
  return { playsinline: 1, rel: 0, controls: 0, disablekb: 1, origin }
}
