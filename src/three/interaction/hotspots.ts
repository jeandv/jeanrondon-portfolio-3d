import type { SoundId } from '../../audio/sfx'
import { POSTERS, posterLabel } from '../../content/posters'
import { TAPES, tapeNodeName } from '../../content/work'
import { openResume } from '../../screens/links'
import type { AppState } from '../../state/store'
import { isEmpty } from '../objects/coffee/cup'
import { ledColor } from '../objects/decor/lights'

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
  /**
   * Click sound (default 'click'); a function picks it per state, and null
   * stays silent (the object plays its own, e.g. the sip as the mug arrives).
   */
  readonly sound?: SoundId | ((state: AppState) => SoundId | null)
  /** Hover only: a tooltip, the default cursor and no highlight; a click does nothing. */
  readonly passive?: boolean
  /** Tooltip text, or null when the hotspot is inactive in this state. */
  label(state: AppState): string | null
  activate(state: AppState): void
}

/** Hotspot id of a poster (the batched poster mesh reports hovers under it). */
export const posterHotspotId = (id: string) => `poster:${id}`

/** The LED strip behind the desk (objects/Decor.tsx reports hovers on its glow). */
export const LED_HOTSPOT = 'led'

/** Pointer travel (px) above which a click counts as a drag and is ignored. */
export const DRAG_THRESHOLD = 5

/** While the CV card is up, any hover says this and any click puts it back. */
export const PUT_BACK_CV = 'PUT BACK CV'
/** The CV card's own hit rect (objects/CvCard.tsx reports hovers on its OPEN CV button under this id). */
export const CV_BUTTON_HOTSPOT = 'cv:open'
/** Over the card's OPEN CV button. */
export const OPEN_CV = 'OPEN CV'
/** While the calculator is held up, anything but its keypad says this and a click puts it down. */
export const PUT_DOWN_CALCULATOR = 'PUT DOWN CALCULATOR'

const PC_NODES = ['pc_body', 'pc_monitor', 'pc_screen', 'pc_keyboard'] as const
/** `lamp_arm` (and a Blender `lamp_bulb`) are optional. */
const LAMP_NODES = ['lamp_head', 'lamp_arm'] as const

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
    // The reference dropped its lamp key binding: click only.
    id: 'lamp',
    nodes: LAMP_NODES,
    highlight: LAMP_NODES,
    sound: 'lamp',
    label: (state) => (state.lampOn ? 'LAMP OFF' : 'LAMP ON'),
    activate: (state) => state.toggleLamp(),
  },
  {
    id: 'notepad',
    nodes: ['notepad'],
    highlight: ['notepad', 'notepad_page'],
    label: (state) => (readingNotepad(state) ? 'PUT DOWN NOTEPAD' : 'READ NOTEPAD'),
    activate: (state) => state.navigate(readingNotepad(state) ? '#home' : '#work'),
  },
  {
    // The sip sound plays when the mug reaches the lips (objects/Coffee.tsx); an empty mug clinks.
    id: 'coffee',
    nodes: ['coffee_mug'],
    highlight: ['coffee_mug'],
    sound: (state) => (isEmpty(state.cup) ? 'clink' : null),
    label: (state) => (isEmpty(state.cup) ? 'EMPTY' : 'TAKE A SIP'),
    activate: (state) => state.sipCoffee(),
  },
  {
    id: 'clock',
    nodes: ['wall_clock'],
    highlight: ['wall_clock'],
    label: (state) => (state.clock.running ? 'TAKE BATTERY OUT' : 'PUT BATTERY BACK'),
    activate: (state) => state.toggleClockBattery(),
  },
  {
    id: 'rolodex',
    nodes: ['rolodex'],
    highlight: ['rolodex'],
    sound: 'card',
    label: () => 'VIEW CV',
    activate: (state) => state.setCvOpen(true),
  },
  {
    // M does the same. In the close-up the lid and the LCD buttons take their own clicks (objects/CdPlayer.tsx).
    id: 'cd',
    nodes: ['cd_player'],
    highlight: ['cd_player', 'cd_lid'],
    label: (state) => (state.zoom === 'cd' ? 'BACK TO THE DESK' : 'USE CD PLAYER'),
    activate: (state) => state.toggleCdView(),
  },
  {
    // Up, its keypad takes the clicks (objects/Calculator.tsx); the rest of it puts it down.
    id: 'calculator',
    nodes: ['calculator'],
    highlight: ['calculator'],
    sound: 'calc',
    label: (state) => (state.calcUp ? PUT_DOWN_CALCULATOR : 'USE CALCULATOR'),
    activate: (state) => state.toggleCalc(),
  },
  {
    // The floating card itself (objects/CvCard.tsx handles its pointer events).
    id: 'cv',
    nodes: [],
    highlight: [],
    sound: 'card',
    label: (state) => (state.cvOpen ? PUT_BACK_CV : null),
    activate: (state) => state.setCvOpen(false),
  },
  {
    // The card's OPEN CV button: opens the CV in a new tab (the card stays up).
    id: CV_BUTTON_HOTSPOT,
    nodes: [],
    highlight: [],
    label: (state) => (state.cvOpen ? OPEN_CV : null),
    activate: () => openResume(),
  },
  {
    // The LED strip behind the desk: names its colour; a click cycles violet → teal → amber → off.
    id: LED_HOTSPOT,
    nodes: [],
    highlight: [],
    label: (state) => `LED: ${ledColor(state.led).label}`,
    activate: (state) => state.cycleLed(),
  },
  // The posters (objects/Posters.tsx picks them on the batched mesh): a title on hover, nothing on click (yet).
  ...POSTERS.map(
    (poster): HotspotDef => ({
      id: posterHotspotId(poster.id),
      nodes: [],
      highlight: [],
      passive: true,
      sound: () => null,
      label: () => posterLabel(poster),
      activate: () => undefined,
    }),
  ),
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

/** The sound a click on `def` makes in `state` (null: silent). */
export function clickSound(def: HotspotDef, state: AppState): SoundId | null {
  return typeof def.sound === 'function' ? def.sound(state) : (def.sound ?? 'click')
}

/** Every mesh that needs its own material copy for hover highlights. */
export const INTERACTIVE_NODES: ReadonlySet<string> = new Set(HOTSPOTS.flatMap((def) => def.highlight))

/**
 * Active tooltip label for the current state (null = nothing to show; '' =
 * a pointer cursor without a tooltip, e.g. over a calculator key). A screen
 * hit rect wins over the hotspot behind it; with the CV card up, its OPEN CV
 * button says OPEN CV and anything else under the pointer puts it back; with
 * the calculator up, anything but the calculator puts it down.
 */
export function activeLabel(state: AppState): string | null {
  if (state.flying || state.phase !== 'live') return null
  if (state.cvOpen) {
    if (state.hovered === CV_BUTTON_HOTSPOT) return OPEN_CV
    return state.hovered !== null || state.screenHover !== null ? PUT_BACK_CV : null
  }
  if (state.screenHover) return state.screenHover.label
  if (state.calcUp) return state.hovered !== null ? PUT_DOWN_CALCULATOR : null
  return getHotspot(state.hovered)?.label(state) ?? null
}

/** A click on hotspot `id` only puts the held thing back (the CV card, or the calculator unless it is the one clicked). */
export function putsBack(state: AppState, id: string): boolean {
  return state.cvOpen || (state.calcUp && id !== 'calculator')
}
