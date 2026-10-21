import type { DiscInfo } from '../music/discs'
import {
  PREV_RESTART_SECONDS,
  type MusicSource,
  type SourceAction,
  type SourceClock,
  type SourceSnapshot,
  type SourceStatus,
} from '../music/source'
import { playerVars, YT_HOST, YT_STATE, type YtEvent, type YtNamespace, type YtPlayerLike } from './api'

/**
 * Disc 2: the Joji playlist on the YouTube IFrame Player, behind the same
 * MusicSource interface as the generated music. The player lives in the
 * mini-player monitor (src/ui/MiniPlayer.tsx), which only exists while this
 * source is not stopped: PLAY asks for it (status `loading`), the monitor
 * mounts and attaches its host element, the API loads (lazily, the first
 * time) and the video starts. STOP (eject) or × destroys the player and the
 * monitor goes away. A video that ends rolls into the next one; one that
 * errors shows ERR for ~1 s and is skipped (all of them failing stops).
 */

export interface Timers {
  set(callback: () => void, ms: number): number
  clear(id: number): void
}

export interface YouTubeSourceOptions {
  readonly disc: DiscInfo
  readonly videoIds: readonly string[]
  readonly loadApi: () => Promise<YtNamespace>
  readonly timers: Timers
  /** location.origin, passed to the player for the JS API. */
  readonly origin: string
  /** Discrete state changes (the store mirrors them). */
  readonly onChange: (snapshot: SourceSnapshot) => void
  readonly volume?: number
  readonly muted?: boolean
}

/** How long the LCD shows ERR before the next video. */
export const ERROR_SKIP_MS = 1000

/** Maps a YT.PlayerState onto the CD player's status (pure). */
export function mapPlayerState(state: number, current: SourceStatus): SourceStatus {
  switch (state) {
    case YT_STATE.playing:
      return 'playing'
    case YT_STATE.paused:
      return 'paused'
    case YT_STATE.buffering:
      return current === 'playing' ? 'playing' : 'loading'
    case YT_STATE.cued:
      return current === 'loading' ? 'loading' : 'paused'
    case YT_STATE.unstarted:
      return current === 'stopped' ? 'stopped' : 'loading'
    default:
      return current
  }
}

const wrap = (index: number, count: number) => ((index % count) + count) % count

export class YouTubeSource implements MusicSource {
  readonly disc: DiscInfo
  private readonly options: YouTubeSourceOptions
  private player: YtPlayerLike | null = null
  private ready = false
  private host: HTMLElement | null = null
  private creating = false
  /** The video the player was built with (onReady loads another if the track moved meanwhile). */
  private builtWith = ''
  private status: SourceStatus = 'stopped'
  private track = 0
  private error = false
  private errorTimer: number | null = null
  private failures = 0
  private volume: number
  private muted: boolean
  private resumeOnShow = false
  /** Bumped on every stop: a late API load or player event from before is ignored. */
  private session = 0

  constructor(options: YouTubeSourceOptions) {
    this.options = options
    this.disc = options.disc
    this.volume = options.volume ?? 80
    this.muted = options.muted ?? false
  }

  snapshot(): SourceSnapshot {
    return { status: this.status, track: this.track, error: this.error }
  }

  clock(): SourceClock {
    if (!this.player || !this.ready) return { elapsed: 0, duration: null }
    const elapsed = this.player.getCurrentTime()
    const duration = this.player.getDuration()
    return { elapsed: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0, duration: duration > 0 ? duration : null }
  }

  /** The monitor's host element is in the page: build the player if one is wanted. */
  attach(host: HTMLElement): void {
    this.host = host
    if (this.status !== 'stopped') this.ensurePlayer()
  }

  /** The monitor is going away: the player goes with it (never left hidden). */
  detach(host: HTMLElement): void {
    if (this.host !== host) return
    this.host = null
    this.destroyPlayer()
  }

  press(action: SourceAction): void {
    switch (action) {
      case 'play':
        if (this.status !== 'playing') this.start()
        return
      case 'toggle':
        if (this.status === 'playing' || this.status === 'loading') this.pause()
        else this.start()
        return
      case 'pause':
        this.pause()
        return
      case 'stop':
        this.stop()
        return
      case 'next':
        this.failures = 0
        this.jump(this.track + 1)
        return
      case 'prev': {
        this.failures = 0
        const { elapsed } = this.clock()
        if (this.status !== 'stopped' && elapsed > PREV_RESTART_SECONDS && this.player && this.ready) {
          this.player.seekTo(0, true)
          return
        }
        this.jump(this.track - 1)
        return
      }
    }
  }

  playTrack(index: number): void {
    this.track = wrap(index, this.count)
    this.failures = 0
    if (this.player && this.ready) {
      this.setStatus('loading')
      this.player.loadVideoById(this.videoId)
    } else {
      this.start()
    }
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.player && this.ready) this.player.setVolume(volume)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (!this.player || !this.ready) return
    if (muted) this.player.mute()
    else this.player.unMute()
  }

  setHidden(hidden: boolean): void {
    if (hidden) {
      if (this.status === 'playing' && this.player && this.ready) {
        this.resumeOnShow = true
        this.player.pauseVideo()
      }
      return
    }
    if (this.resumeOnShow && this.player && this.ready) this.player.playVideo()
    this.resumeOnShow = false
  }

  /** Eject: stop, drop the player (the monitor unmounts), back to track 1's place on the disc. */
  stop(): void {
    this.session++
    this.clearError()
    this.resumeOnShow = false
    this.failures = 0
    this.destroyPlayer()
    this.setStatus('stopped')
  }

  private get count(): number {
    return Math.max(1, this.options.videoIds.length)
  }

  private get videoId(): string {
    return this.options.videoIds[wrap(this.track, this.count)] ?? ''
  }

  private start(): void {
    if (this.player && this.ready) {
      this.setStatus(this.status === 'paused' ? 'playing' : 'loading')
      this.player.playVideo()
      return
    }
    this.setStatus('loading')
    this.ensurePlayer()
  }

  private pause(): void {
    if (this.player && this.ready && (this.status === 'playing' || this.status === 'loading')) {
      this.player.pauseVideo()
      this.setStatus('paused')
    }
  }

  /** Moves to `index` (the error skip keeps counting failures; the buttons reset that count). */
  private jump(index: number): void {
    this.track = wrap(index, this.count)
    this.clearError()
    if (!this.player || !this.ready) {
      this.notify()
      return
    }
    if (this.status === 'playing' || this.status === 'loading') {
      this.setStatus('loading')
      this.player.loadVideoById(this.videoId)
    } else {
      this.player.cueVideoById(this.videoId)
      this.notify()
    }
  }

  private ensurePlayer(): void {
    if (this.player || this.creating || !this.host) return
    const host = this.host
    const session = this.session
    this.creating = true
    this.options
      .loadApi()
      .then((api) => {
        this.creating = false
        if (session !== this.session || this.host !== host || this.player) return
        const target = document.createElement('div')
        host.replaceChildren(target)
        this.ready = false
        this.builtWith = this.videoId
        this.player = new api.Player(target, {
          host: YT_HOST,
          width: '100%',
          height: '100%',
          videoId: this.videoId,
          playerVars: playerVars(this.options.origin),
          events: {
            onReady: (event) => this.onReady(event, session),
            onStateChange: (event) => this.onState(event, session),
            onError: (event) => this.onError(event, session),
          },
        })
      })
      .catch(() => {
        this.creating = false
        if (session !== this.session) return
        // Offline or blocked: ERR for a moment, then the disc stops.
        this.showError(() => this.stop())
      })
  }

  private onReady(event: YtEvent, session: number): void {
    if (session !== this.session) return
    this.ready = true
    const player = event.target
    player.setVolume(this.volume)
    if (this.muted) player.mute()
    else player.unMute()
    if (this.status !== 'loading' && this.status !== 'playing') return
    if (this.builtWith === this.videoId) player.playVideo()
    else player.loadVideoById(this.videoId)
  }

  private onState(event: YtEvent, session: number): void {
    if (session !== this.session || event.data === undefined) return
    if (event.data === YT_STATE.ended) {
      this.jump(this.track + 1)
      return
    }
    if (event.data === YT_STATE.playing) this.failures = 0
    // A pause we did not ask for (the hidden-tab pause keeps its resume flag).
    this.setStatus(mapPlayerState(event.data, this.status))
  }

  private onError(_event: YtEvent, session: number): void {
    if (session !== this.session) return
    this.failures++
    if (this.failures >= this.count) {
      this.showError(() => this.stop())
      return
    }
    this.showError(() => this.jump(this.track + 1))
  }

  private showError(then: () => void): void {
    this.clearError()
    this.error = true
    this.notify()
    const session = this.session
    this.errorTimer = this.options.timers.set(() => {
      this.errorTimer = null
      this.error = false
      if (session === this.session) then()
      this.notify()
    }, ERROR_SKIP_MS)
  }

  private clearError(): void {
    if (this.errorTimer !== null) this.options.timers.clear(this.errorTimer)
    this.errorTimer = null
    this.error = false
  }

  private destroyPlayer(): void {
    const player = this.player
    this.player = null
    this.ready = false
    if (!player) return
    try {
      player.destroy()
    } catch {
      // Already gone with its iframe.
    }
  }

  private setStatus(status: SourceStatus): void {
    if (status === this.status) return
    this.status = status
    this.notify()
  }

  private notify(): void {
    this.options.onChange(this.snapshot())
  }
}
