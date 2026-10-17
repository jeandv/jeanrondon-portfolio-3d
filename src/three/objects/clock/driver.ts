import { Vector3, type Object3D } from 'three'
import { sfx } from '../../../audio/sfx'
import { CAPTURE } from '../../../capture/mode'
import { useStore, type AppState } from '../../../state/store'
import { HingeTurn } from '../motion'
import { CAPTURE_LOCAL_TIME, ClockDial, localSeconds, type HandAngles } from './dial'

const FACE_NORMAL = new Vector3(0, 0, 1)

/** The tick is only heard at the computer (the clock hangs beside it). */
function nearClock({ route, zoom, flying, phase }: AppState): boolean {
  return phase === 'live' && !flying && zoom === null && (route.page === 'about' || route.page === 'online')
}

/**
 * The wall clock (`wall_clock` + `clock_hour` / `clock_minute` / `clock_second`):
 * the visitor's local time, the second hand ticking once a second with a
 * small spring overshoot, a very soft tick at the computer. The battery
 * (store) stops it on the time it came out; back in, the hands sweep forward
 * to the live time. ?capture: a fixed 10:09:30.
 */
interface ClockHands {
  readonly hour: HingeTurn | null
  readonly minute: HingeTurn | null
  readonly second: HingeTurn | null
}

export class ClockDriver {
  private readonly hands: ClockHands
  private readonly dial: ClockDial

  static create(room: Object3D): ClockDriver | null {
    if (!room.getObjectByName('wall_clock')) return null
    const hand = (name: string) => {
      const node = room.getObjectByName(name)
      return node ? new HingeTurn(node, FACE_NORMAL) : null
    }
    return new ClockDriver({ hour: hand('clock_hour'), minute: hand('clock_minute'), second: hand('clock_second') })
  }

  private constructor(hands: ClockHands) {
    this.hands = hands
    this.dial = new ClockDial(this.now())
  }

  /** Follows the battery in the store; returns the cleanup. */
  start(): () => void {
    this.syncBattery(useStore.getState(), true)
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.clock !== previous.clock) this.syncBattery(state, state.reducedMotion)
    })
    return () => {
      unsubscribe()
      this.apply({ hour: 0, minute: 0, second: 0 })
    }
  }

  frame(delta: number): void {
    const state = useStore.getState()
    const angles = CAPTURE ? this.dial.update(CAPTURE_LOCAL_TIME, 0, true) : this.dial.update(this.now(), delta, state.reducedMotion)
    this.apply(angles)
    if (this.dial.justTicked && !CAPTURE && nearClock(state)) sfx('clock')
  }

  private now(): number {
    return CAPTURE ? CAPTURE_LOCAL_TIME : localSeconds(Date.now())
  }

  private syncBattery({ clock }: AppState, instant: boolean): void {
    if (CAPTURE) return
    if (clock.running) {
      this.dial.start(this.now(), instant)
    } else {
      const stoppedAt = clock.stoppedAt ?? Date.now()
      this.dial.stop(localSeconds(stoppedAt))
    }
  }

  /** Clockwise angles → turns about each hand's local +Z (toward the room). */
  private apply({ hour, minute, second }: HandAngles): void {
    this.hands.hour?.set(-hour)
    this.hands.minute?.set(-minute)
    this.hands.second?.set(-second)
  }
}
