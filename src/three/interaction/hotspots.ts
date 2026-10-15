import { TAPES, tapeNodeName } from '../../content/work'
import type { AppState } from '../../state/store'

/**
 * Hotspot registry (three-free so the DOM tooltip can use it from the main chunk).
 * Each hotspot gets an invisible proxy box on every node in `nodes`.
 */
export interface HotspotDef {
  readonly id: string
  /** GLB nodes that receive a proxy box. */
  readonly nodes: readonly string[]
  /** GLB meshes whose material is bumped on hover. */
  readonly highlight: readonly string[]
  /** Tooltip text, or null when the hotspot is inactive in this state. */
  label(state: AppState): string | null
  activate(state: AppState): void
}

/** Pointer travel (px) above which a click counts as a drag and is ignored. */
export const DRAG_THRESHOLD = 5

const PC_NODES = ['pc_body', 'pc_monitor', 'pc_screen', 'pc_keyboard'] as const

const atComputer = (state: AppState) =>
  state.zoom === null && (state.route.page === 'about' || state.route.page === 'online')

const readingNotepad = (state: AppState) => state.zoom === null && state.route.page === 'work'

export const HOTSPOTS: readonly HotspotDef[] = [
  {
    id: 'pc',
    nodes: PC_NODES,
    highlight: PC_NODES,
    label: (state) => (atComputer(state) ? null : 'USE COMPUTER'),
    activate: (state) => state.navigate('#about'),
  },
  {
    id: 'tv',
    nodes: ['tv_body'],
    highlight: ['tv_body'],
    label: (state) => (state.zoom === 'tv' ? null : 'WATCH TV'),
    activate: (state) => state.setZoom('tv'),
  },
  {
    id: 'notepad',
    nodes: ['notepad'],
    highlight: ['notepad', 'notepad_page'],
    label: (state) => (readingNotepad(state) ? 'PUT DOWN NOTEPAD' : 'READ NOTEPAD'),
    activate: (state) => state.navigate(readingNotepad(state) ? '#home' : '#work'),
  },
  ...TAPES.map((tape): HotspotDef => {
    const node = tapeNodeName(tape.slot)
    return {
      id: node,
      nodes: [node],
      highlight: [node],
      label: () => `PLAY ${tape.title.toUpperCase()}`,
      activate: (state) => state.navigate(`#work/${tape.id}`),
    }
  }),
]

const BY_ID: ReadonlyMap<string, HotspotDef> = new Map(HOTSPOTS.map((def) => [def.id, def]))

export function getHotspot(id: string | null): HotspotDef | undefined {
  return id === null ? undefined : BY_ID.get(id)
}

/** Every mesh that needs its own material copy for hover highlights. */
export const INTERACTIVE_NODES: ReadonlySet<string> = new Set(HOTSPOTS.flatMap((def) => def.highlight))

/** Active tooltip label for the current state (null = nothing to show). A screen hit rect wins over the hotspot behind it. */
export function activeLabel(state: AppState): string | null {
  if (state.flying || state.phase !== 'live') return null
  if (state.screenHover) return state.screenHover.label
  return getHotspot(state.hovered)?.label(state) ?? null
}
