import { Vector3, type Mesh, type Object3D } from 'three'
import { sfx } from '../../../audio/sfx'
import { CAPTURE } from '../../../capture/mode'
import { TAPES, tapeNodeName } from '../../../content/work'
import { useStore } from '../../../state/store'
import { FRAMES, positionFor } from '../../camera/frames'
import { activeLabel, getHotspot } from '../../interaction/hotspots'
import { clampDt } from '../motion'
import { deckTarget, sameStatus, TapeDeck } from './deck'
import { emitDeckEvents } from './deckEvents'
import { createTapeLabels, type TapeLabels } from './labels'
import { sampleTapePath } from './path'
import { buildTapeRig, slotFrame, type TapeRig } from './rig'

/** The default (home) camera: spines and labels face it. */
function homeViewer(): Vector3 {
  const home = FRAMES.home
  return positionFor(new Vector3(...home.target), home.dir, home.distance)
}

/** The hovered tape node while its tooltip shows (its label brightens with it). */
function hoveredTapeNode(): string | null {
  const state = useStore.getState()
  if (state.screenHover || activeLabel(state) === null) return null
  const def = getHotspot(state.hovered)
  return def?.id.startsWith('tape_') ? def.id : null
}

/**
 * Runs the shelf every frame: route → deck target, deck step → events
 * (sounds, flap via deckEvents), tape poses along their paths, the VCR
 * status into the store (on transitions only) and the spine labels.
 */
export class TapeDriver {
  private readonly deck: TapeDeck
  private readonly rigs: readonly TapeRig[]
  private readonly labels: TapeLabels | null
  private target: string | null = null

  constructor(room: Object3D) {
    const viewer = homeViewer()
    const slot = slotFrame(room, viewer)
    this.rigs = slot
      ? TAPES.flatMap((tape) => {
          const node = room.getObjectByName(tapeNodeName(tape.slot))
          return node ? [buildTapeRig(tape.id, node, slot, viewer)] : []
        })
      : []
    this.deck = new TapeDeck(this.rigs.map((rig) => rig.id))
    this.labels = createTapeLabels(room, viewer)
  }

  /** The batched label mesh (null without tape nodes). */
  get labelMesh(): Mesh | null {
    return this.labels?.mesh ?? null
  }

  drawLabels(): void {
    this.labels?.draw()
  }

  frame(delta: number): void {
    const store = useStore.getState()
    this.target = deckTarget(this.target, store.phase, store.route)
    this.deck.setTarget(this.target)
    const events = this.deck.update(clampDt(delta), store.reducedMotion || CAPTURE)
    if (events.length > 0) {
      for (const event of events) {
        if (event.type === 'inserted') sfx('tape')
        else if (event.type === 'eject') sfx('eject')
      }
      emitDeckEvents(events)
    }
    for (const rig of this.rigs) {
      rig.node.visible = sampleTapePath(rig.path, this.deck.progress(rig.id), rig.node.position, rig.node.quaternion)
    }
    const status = this.deck.status()
    if (!sameStatus(status, store.vcr)) store.setVcr(status)
    this.labels?.update(hoveredTapeNode())
  }

  /** Puts every tape back on the shelf (unmount). */
  reset(): void {
    for (const { node, path } of this.rigs) {
      node.position.copy(path.rest.position)
      node.quaternion.copy(path.rest.quaternion)
      node.visible = true
    }
  }

  dispose(): void {
    this.labels?.dispose()
  }
}
