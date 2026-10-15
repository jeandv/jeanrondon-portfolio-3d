import type { ScreenDevice } from './routing'

/**
 * Keyboard bridge between the DOM hook (main chunk) and the screens (3D
 * chunk): each mounted screen registers a handler for its device.
 */

type KeyHandler = (key: string) => boolean

const handlers = new Map<ScreenDevice, KeyHandler>()

export function registerScreenKeys(device: ScreenDevice, handler: KeyHandler): () => void {
  handlers.set(device, handler)
  return () => {
    if (handlers.get(device) === handler) handlers.delete(device)
  }
}

/** Offers the key to each device in order; true as soon as one uses it. */
export function dispatchScreenKey(devices: readonly ScreenDevice[], key: string): boolean {
  for (const device of devices) {
    if (handlers.get(device)?.(key)) return true
  }
  return false
}
