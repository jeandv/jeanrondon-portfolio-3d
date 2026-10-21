import { CONTACT_MENU } from '../../../content/contactMenu'
import { PROFILE } from '../../../content/profile'
import type { Channel } from '../../channel'
import type { PcChannelKey } from '../../routing'
import { createAboutChannel } from './about'
import { createContactChannel, type BbsHooks } from './contact'
import { createIdleChannel } from './idle'

/** Builds the PC channel for a route key (content comes from src/content); `bbs` wraps the contact menu in the dial-up. */
export function createPcChannel(key: PcChannelKey, bbs?: BbsHooks): Channel {
  switch (key) {
    case 'about':
      return createAboutChannel(PROFILE)
    case 'contact':
      return createContactChannel(CONTACT_MENU, bbs)
    case 'idle':
      return createIdleChannel()
  }
}
