import { describe, expect, it } from 'vitest'
import { STEAM_FADE, stepSteamLift } from './driver'

describe('steam during a sip', () => {
  it('fades out quickly as the mug lifts and back in slowly once it is down', () => {
    let lift = 1
    for (let t = 0; t < STEAM_FADE.out * 4; t += 1 / 60) lift = stepSteamLift(lift, true, 1 / 60)
    expect(lift).toBeLessThan(0.05)
    for (let t = 0; t < STEAM_FADE.in; t += 1 / 60) lift = stepSteamLift(lift, false, 1 / 60)
    expect(lift).toBeGreaterThan(0.55)
    expect(lift).toBeLessThan(0.75)
    for (let t = 0; t < STEAM_FADE.in * 8; t += 1 / 60) lift = stepSteamLift(lift, false, 1 / 60)
    expect(lift).toBe(1)
  })

  it('never jumps: one frame moves it only part of the way', () => {
    expect(stepSteamLift(1, true, 1 / 60)).toBeGreaterThan(0.7)
    expect(stepSteamLift(0, false, 1 / 60)).toBeLessThan(0.05)
    expect(stepSteamLift(0.5, false, 0)).toBe(0.5)
  })
})
