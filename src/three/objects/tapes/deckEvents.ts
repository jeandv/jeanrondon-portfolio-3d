import type { DeckEvent } from './deck'

/** Deck events (flap, inserted, eject, parked) for the parts of the room that react to them. */

type Listener = (event: DeckEvent) => void

const listeners = new Set<Listener>()

export function onDeckEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitDeckEvents(events: readonly DeckEvent[]): void {
  for (const event of events) for (const listener of listeners) listener(event)
}
