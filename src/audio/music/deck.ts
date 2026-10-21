import type { CdLid } from '../../three/objects/cd/player'
import { nextDisc, type DiscId } from './discs'
import type { MusicSource, SourceAction } from './source'

/**
 * The CD player's brain, source-agnostic: it holds a MusicSource per disc and
 * routes the LCD buttons and the keys to the one in the player. Only one
 * plays at a time (starting one stops the other), DISC ejects the playing
 * disc and puts the other one in (stopped), and opening the lid stops it,
 * like a real player. Pure apart from what the sources do.
 */

export interface DeckHost {
  readonly disc: () => DiscId
  readonly setDisc: (disc: DiscId) => void
  readonly lid: () => CdLid
  /** Opens / shuts the lid (the generated disc stops when it opens). */
  readonly toggleLid: () => void
}

export class MusicDeck {
  readonly sources: Readonly<Record<DiscId, MusicSource>>
  private readonly host: DeckHost

  constructor(sources: Readonly<Record<DiscId, MusicSource>>, host: DeckHost) {
    this.sources = sources
    this.host = host
  }

  active(): MusicSource {
    return this.sources[this.host.disc()]
  }

  press(action: SourceAction): void {
    const active = this.active()
    const starting = (action === 'play' || action === 'toggle') && active.snapshot().status !== 'playing'
    if (starting) {
      this.stopOthers(active)
      // Play shuts the lid first.
      if (this.host.lid() === 'open') this.host.toggleLid()
    }
    active.press(action)
  }

  playTrack(index: number): void {
    const active = this.active()
    this.stopOthers(active)
    if (this.host.lid() === 'open') this.host.toggleLid()
    active.playTrack(index)
  }

  /** DISC: the disc in the player comes out (stopped) and the other one goes in. */
  swapDisc(): DiscId {
    this.active().press('stop')
    const next = nextDisc(this.host.disc())
    this.host.setDisc(next)
    return next
  }

  /** The lid: opening it stops whatever plays. */
  lid(): void {
    const opening = this.host.lid() === 'closed'
    if (opening) {
      for (const source of Object.values(this.sources)) {
        if (source.snapshot().status !== 'stopped') source.press('stop')
      }
    }
    this.host.toggleLid()
  }

  setVolume(volume: number): void {
    for (const source of Object.values(this.sources)) source.setVolume(volume)
  }

  setMuted(muted: boolean): void {
    for (const source of Object.values(this.sources)) source.setMuted(muted)
  }

  setHidden(hidden: boolean): void {
    for (const source of Object.values(this.sources)) source.setHidden(hidden)
  }

  private stopOthers(active: MusicSource): void {
    for (const source of Object.values(this.sources)) {
      if (source !== active && source.snapshot().status !== 'stopped') source.press('stop')
    }
  }
}
