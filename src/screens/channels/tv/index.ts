import { PROFILE } from '../../../content/profile'
import { TAPES, tapeById } from '../../../content/work'
import type { Channel } from '../../channel'
import type { TvChannelKey } from '../../routing'
import { createHomeChannel } from './home'
import { createInsertTapeChannel } from './insertTape'
import { createTapeChannel } from './tape'

export { createBootChannel } from './boot'

const TAPE_SLOTS: readonly number[] = TAPES.map((tape) => tape.slot)

/** Builds the TV channel for a route key (content comes from src/content). */
export function createTvChannel(key: TvChannelKey): Channel {
  switch (key.kind) {
    case 'home':
      return createHomeChannel(PROFILE)
    case 'insertTape':
      return createInsertTapeChannel(TAPE_SLOTS)
    case 'tape': {
      const tape = tapeById(key.tape)
      return tape ? createTapeChannel(tape) : createInsertTapeChannel(TAPE_SLOTS)
    }
  }
}
