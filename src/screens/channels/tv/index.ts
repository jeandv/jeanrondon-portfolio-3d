import { PROFILE } from '../../../content/profile'
import { TAPES, tapeById } from '../../../content/work'
import type { Channel } from '../../channel'
import type { TvChannelKey } from '../../routing'
import { createHomeChannel } from './home'
import { createInsertTapeChannel } from './insertTape'
import { createTapeChannel } from './tape'

export { createBootChannel } from './boot'

/** Builds the TV channel for a route key (content comes from src/content). */
export function createTvChannel(key: TvChannelKey): Channel {
  switch (key.kind) {
    case 'home':
      return createHomeChannel(PROFILE)
    case 'insertTape':
      return createInsertTapeChannel(TAPES.length)
    case 'tape': {
      const tape = tapeById(key.tape)
      return tape ? createTapeChannel(tape) : createInsertTapeChannel(TAPES.length)
    }
  }
}
