import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRACK_SECONDS } from '../../audio/music/tracks'
import { RESUME } from '../../content/resume'
import { useStore } from '../../state/store'
import { CALC_RESET } from '../objects/calc/engine'
import { CD_STOPPED } from '../objects/cd/player'
import { BATTERY_IN } from '../objects/clock/battery'
import { fullCup, SIP_SECONDS, SIPS_PER_CUP } from '../objects/coffee/cup'
import {
  activeLabel,
  clickSound,
  CV_BUTTON_HOTSPOT,
  getHotspot,
  INTERACTIVE_NODES,
  OPEN_CV,
  PUT_BACK_CV,
  PUT_DOWN_CALCULATOR,
  putsBack,
} from './hotspots'

const coffee = () => getHotspot('coffee')
const clock = () => getHotspot('clock')

beforeEach(() => {
  useStore.setState({
    phase: 'live',
    flying: false,
    zoom: null,
    hovered: null,
    screenHover: null,
    cvOpen: false,
    cup: fullCup(0),
    clock: BATTERY_IN,
    route: { page: 'home' },
    cd: CD_STOPPED,
    calcUp: false,
    calc: CALC_RESET,
  })
})

describe('CD player hotspot and close-up', () => {
  it('USE CD PLAYER flies to the close-up (a camera mode, not a route); a second click goes back', () => {
    const def = getHotspot('cd')
    if (!def) throw new Error('no cd hotspot')
    expect(def.label(useStore.getState())).toBe('USE CD PLAYER')
    def.activate(useStore.getState())
    expect(useStore.getState().zoom).toBe('cd')
    expect(useStore.getState().route).toEqual({ page: 'home' })
    expect(def.label(useStore.getState())).toBe('BACK TO THE DESK')
    def.activate(useStore.getState())
    expect(useStore.getState().zoom).toBeNull()
    expect(INTERACTIVE_NODES.has('cd_player')).toBe(true)
  })

  it('never plays on its own; leaving the close-up shuts the lid and keeps the music playing', () => {
    const store = useStore.getState()
    store.toggleCdView()
    expect(useStore.getState().cd.status).toBe('stopped')
    useStore.getState().cdAction('lid', 1)
    expect(useStore.getState().cd.lid).toBe('open')
    useStore.getState().cdAction('play', 2)
    expect(useStore.getState().cd).toMatchObject({ lid: 'closed', status: 'playing' })
    useStore.getState().cdAction('lid', 3)
    useStore.getState().cdAction('play', 4)
    useStore.getState().back()
    expect(useStore.getState().zoom).toBeNull()
    expect(useStore.getState().cd).toMatchObject({ lid: 'closed', status: 'playing' })
    // Z from the CD close-up goes to the TV, and the lid stays shut.
    useStore.getState().toggleCdView()
    useStore.getState().cdAction('lid', 5)
    useStore.getState().toggleZoom()
    expect(useStore.getState().zoom).toBe('tv')
    expect(useStore.getState().cd.lid).toBe('closed')
  })

  it('a track change follows the disc (settle)', () => {
    useStore.getState().cdAction('play', 0)
    const before = useStore.getState().cd
    useStore.getState().settleCd(5)
    expect(useStore.getState().cd).toBe(before)
    useStore.getState().settleCd((TRACK_SECONDS[0] ?? 0) + 1)
    expect(useStore.getState().cd).toMatchObject({ status: 'playing', track: 1 })
    useStore.getState().cdPlayTrack(2, 7)
    expect(useStore.getState().cd).toMatchObject({ status: 'playing', track: 2, since: 7 })
  })
})

describe('calculator hotspot', () => {
  it('USE CALCULATOR lifts it; it computes; anything else puts it down', () => {
    const def = getHotspot('calculator')
    if (!def) throw new Error('no calculator hotspot')
    expect(def.label(useStore.getState())).toBe('USE CALCULATOR')
    def.activate(useStore.getState())
    expect(useStore.getState().calcUp).toBe(true)
    expect(def.label(useStore.getState())).toBe(PUT_DOWN_CALCULATOR)
    for (const key of ['1', '2', '+', '3', '0', '='] as const) useStore.getState().calcInput(key)
    expect(useStore.getState().calc.display).toBe('42')
    // Over another hotspot: PUT DOWN CALCULATOR, and its click only puts it down.
    useStore.setState({ hovered: 'tv' })
    expect(activeLabel(useStore.getState())).toBe(PUT_DOWN_CALCULATOR)
    expect(putsBack(useStore.getState(), 'tv')).toBe(true)
    expect(putsBack(useStore.getState(), 'calculator')).toBe(false)
    // Over a key: a hand cursor, no tooltip.
    useStore.setState({ screenHover: { device: 'calculator', id: '7', label: '' } })
    expect(activeLabel(useStore.getState())).toBe('')
    useStore.setState({ screenHover: null })
    expect(INTERACTIVE_NODES.has('calculator')).toBe(true)
  })

  it('Esc / a click in the void (back) puts it down before leaving a close-up; one thing in hand at a time', () => {
    useStore.getState().toggleCdView()
    useStore.getState().setCalcUp(true)
    useStore.getState().back()
    expect(useStore.getState().calcUp).toBe(false)
    expect(useStore.getState().zoom).toBe('cd')
    useStore.getState().setCalcUp(true)
    useStore.getState().setCvOpen(true)
    expect(useStore.getState().calcUp).toBe(false)
    useStore.getState().setCalcUp(true)
    expect(useStore.getState().cvOpen).toBe(false)
    useStore.getState().setRoute({ page: 'about' })
    expect(useStore.getState().calcUp).toBe(false)
    expect(useStore.getState().zoom).toBeNull()
  })
})

describe('coffee mug hotspot', () => {
  it('TAKE A SIP until five sips, then EMPTY with a clink (the sip itself is played by the mug)', () => {
    const def = coffee()
    if (!def) throw new Error('no coffee hotspot')
    expect(def.label(useStore.getState())).toBe('TAKE A SIP')
    expect(clickSound(def, useStore.getState())).toBeNull()
    for (let i = 0; i < SIPS_PER_CUP; i++) useStore.getState().sipCoffee(i * (SIP_SECONDS * 1000 + 1))
    expect(useStore.getState().cup.sips).toBe(SIPS_PER_CUP)
    expect(def.label(useStore.getState())).toBe('EMPTY')
    expect(clickSound(def, useStore.getState())).toBe('clink')
    // Refills once due.
    useStore.getState().refillCup(10 ** 9)
    expect(useStore.getState().cup.sips).toBe(0)
  })

  it('a second click mid-sip does not count', () => {
    useStore.getState().sipCoffee(1000)
    useStore.getState().sipCoffee(1200)
    expect(useStore.getState().cup.sips).toBe(1)
  })

  it('needs its own material copy for the hover glow', () => {
    for (const name of ['coffee_mug', 'wall_clock', 'rolodex']) expect(INTERACTIVE_NODES.has(name)).toBe(true)
  })
})

describe('wall clock hotspot', () => {
  it('takes the battery out (remembering when) and puts it back', () => {
    const def = clock()
    if (!def) throw new Error('no clock hotspot')
    expect(def.label(useStore.getState())).toBe('TAKE BATTERY OUT')
    useStore.getState().toggleClockBattery(4242)
    expect(useStore.getState().clock).toEqual({ running: false, stoppedAt: 4242 })
    expect(def.label(useStore.getState())).toBe('PUT BATTERY BACK')
    useStore.getState().toggleClockBattery(5000)
    expect(useStore.getState().clock.running).toBe(true)
  })
})

describe('CV card', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('the rolodex says VIEW CV and opens it; while up, anything hovered says PUT BACK CV', () => {
    const rolodex = getHotspot('rolodex')
    expect(rolodex?.label(useStore.getState())).toBe('VIEW CV')
    expect(getHotspot('cv')?.label(useStore.getState())).toBeNull()
    rolodex?.activate(useStore.getState())
    expect(useStore.getState().cvOpen).toBe(true)
    expect(PUT_BACK_CV).toBe('PUT BACK CV')
    // Over empty space: no tooltip; over anything (the card, a hotspot): put it back.
    expect(activeLabel(useStore.getState())).toBeNull()
    useStore.setState({ hovered: 'tv' })
    expect(activeLabel(useStore.getState())).toBe(PUT_BACK_CV)
    useStore.setState({ hovered: 'cv' })
    expect(activeLabel(useStore.getState())).toBe(PUT_BACK_CV)
  })

  it('over the OPEN CV button the tooltip says OPEN CV, and only while the card is up', () => {
    useStore.setState({ hovered: CV_BUTTON_HOTSPOT })
    expect(getHotspot(CV_BUTTON_HOTSPOT)?.label(useStore.getState())).toBeNull()
    useStore.getState().setCvOpen(true)
    expect(OPEN_CV).toBe('OPEN CV')
    expect(activeLabel(useStore.getState())).toBe(OPEN_CV)
    expect(getHotspot(CV_BUTTON_HOTSPOT)?.label(useStore.getState())).toBe(OPEN_CV)
  })

  it('OPEN CV opens the CV in a new tab with noopener, and the card stays up', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open, location: { href: '' } })
    useStore.getState().setCvOpen(true)
    getHotspot(CV_BUTTON_HOTSPOT)?.activate(useStore.getState())
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(RESUME.url, '_blank', 'noopener,noreferrer')
    expect(useStore.getState().cvOpen).toBe(true)
  })

  it('Esc / a click elsewhere (back) files it away before anything else', () => {
    useStore.setState({ zoom: 'tv' })
    useStore.getState().setCvOpen(true)
    useStore.getState().back()
    expect(useStore.getState().cvOpen).toBe(false)
    expect(useStore.getState().zoom).toBe('tv')
  })

  it('navigating or zooming puts it back too', () => {
    useStore.getState().setCvOpen(true)
    useStore.getState().setRoute({ page: 'about' })
    expect(useStore.getState().cvOpen).toBe(false)
    useStore.getState().setCvOpen(true)
    expect(useStore.getState().cvOpen).toBe(true)
    useStore.getState().toggleZoom()
    expect(useStore.getState().cvOpen).toBe(false)
  })
})
