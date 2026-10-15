import { LINKS } from '../../../content/links'
import { PROFILE } from '../../../content/profile'
import type { Channel } from '../../channel'
import type { PcChannelKey } from '../../routing'
import { createAboutChannel } from './about'
import { createContactChannel } from './contact'
import { createIdleChannel } from './idle'

/** Builds the PC channel for a route key (content comes from src/content). */
export function createPcChannel(key: PcChannelKey): Channel {
  switch (key) {
    case 'about':
      return createAboutChannel(PROFILE)
    case 'contact':
      return createContactChannel(LINKS)
    case 'idle':
      return createIdleChannel()
  }
}
