/**
 * The CD in the desk's CD player (key M): the disc title and one entry per
 * generated lo-fi track (src/audio/music/tracks.ts makes the music itself, in
 * real time: 0 KB of audio files). The titles scroll on the player's LCD, so
 * keep them to printable ASCII / Latin-1 (the LCD font is VT323).
 */

export interface MusicTrack {
  readonly title: string
}

export interface MusicDisc {
  /** Printed on the disc label and shown on the LCD while stopped. */
  readonly title: string
  readonly artist: string
  /** One per generated track, in play order (src/audio/music/tracks.ts has the same count). */
  readonly tracks: readonly MusicTrack[]
}

// TODO(Jean): rename the disc and the three tracks (placeholder lo-fi titles).
export const MUSIC: MusicDisc = {
  title: 'Night Desk Tapes',
  artist: 'JEAN-NET FM',
  tracks: [
    // TODO(Jean): track 1 (F major, 74 BPM, gentle swing).
    { title: 'Rain on the Window' },
    // TODO(Jean): track 2 (D minor, 82 BPM, the busiest groove).
    { title: 'Last Train Home' },
    // TODO(Jean): track 3 (E-flat major, 70 BPM, the slow one).
    { title: 'Cold Coffee, Warm Lamp' },
  ],
}
