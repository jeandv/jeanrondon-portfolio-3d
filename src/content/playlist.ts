/**
 * Disc 2 in the desk's CD player: Joji, streamed from the artist label's
 * official YouTube uploads (88rising) through the YouTube IFrame Player,
 * shown in the little monitor bottom-left while it plays. Nothing from
 * YouTube loads until a visitor presses PLAY on this disc.
 *
 * TODO(Jean): to add a song, paste its YouTube video id (the 11 characters
 * after `watch?v=`) and the title below, then check it is an official upload
 * that allows embedding by opening
 *   https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json
 * (it must answer with the official channel as `author_name`; a 401 / 404
 * means it cannot be embedded). Titles scroll on the player's LCD: keep them
 * to plain Latin-1.
 */

export interface PlaylistTrack {
  /** YouTube video id (11 characters). */
  readonly videoId: string
  readonly title: string
}

export interface Playlist {
  /** Printed on the disc and shown on the LCD. */
  readonly title: string
  readonly artist: string
  /** Where it streams from (credits, the monitor's caption). */
  readonly source: string
  readonly tracks: readonly PlaylistTrack[]
}

export const JOJI_PLAYLIST: Playlist = {
  title: 'JOJI',
  artist: 'Joji',
  source: '88rising (YouTube)',
  tracks: [
    { videoId: 'FvOpPeKSf_4', title: 'Glimpse of Us' },
    { videoId: 'K3Qzzggn--s', title: 'SLOW DANCING IN THE DARK' },
    { videoId: 'YWN81V7ojOE', title: 'Sanctuary' },
    { videoId: 'PEBS2jbZce4', title: 'TEST DRIVE' },
  ],
}
