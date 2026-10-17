import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../state/store'
import { BATTERY_IN } from '../objects/clock/battery'
import { fullCup, SIP_SECONDS, SIPS_PER_CUP } from '../objects/coffee/cup'
import { activeLabel, clickSound, getHotspot, INTERACTIVE_NODES, PUT_BACK_CREDITS } from './hotspots'

const coffee = () => getHotspot('coffee')
const clock = () => getHotspot('clock')

beforeEach(() => {
  useStore.setState({
    phase: 'live',
    flying: false,
    zoom: null,
    hovered: null,
    screenHover: null,
    creditsOpen: false,
    cup: fullCup(0),
    clock: BATTERY_IN,
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

describe('credits card', () => {
  it('the rolodex opens it; while up, anything hovered says PUT BACK CREDITS', () => {
    const rolodex = getHotspot('rolodex')
    expect(rolodex?.label(useStore.getState())).toBe('READ CREDITS')
    expect(getHotspot('credits')?.label(useStore.getState())).toBeNull()
    rolodex?.activate(useStore.getState())
    expect(useStore.getState().creditsOpen).toBe(true)
    // Over empty space: no tooltip; over anything (the card, a hotspot): put it back.
    expect(activeLabel(useStore.getState())).toBeNull()
    useStore.setState({ hovered: 'tv' })
    expect(activeLabel(useStore.getState())).toBe(PUT_BACK_CREDITS)
    useStore.setState({ hovered: 'credits' })
    expect(activeLabel(useStore.getState())).toBe(PUT_BACK_CREDITS)
  })

  it('Esc / a click elsewhere (back) files it away before anything else', () => {
    useStore.setState({ zoom: 'tv' })
    useStore.getState().setCreditsOpen(true)
    useStore.getState().back()
    expect(useStore.getState().creditsOpen).toBe(false)
    expect(useStore.getState().zoom).toBe('tv')
  })

  it('navigating or zooming puts it back too', () => {
    useStore.getState().setCreditsOpen(true)
    useStore.getState().setRoute({ page: 'about' })
    expect(useStore.getState().creditsOpen).toBe(false)
    useStore.getState().toggleCredits()
    expect(useStore.getState().creditsOpen).toBe(true)
    useStore.getState().toggleZoom()
    expect(useStore.getState().creditsOpen).toBe(false)
  })
})
