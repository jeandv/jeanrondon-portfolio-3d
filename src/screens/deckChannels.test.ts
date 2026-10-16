import { describe, expect, it } from 'vitest'
import { slotKeys } from './keys'
import { pickPhotoUrl } from './polaroid'
import { sameTvChannel, tvChannelForDeck } from './routing'

describe('TV channel with the tape deck', () => {
  it('shows a tape only once it plays in the VCR', () => {
    expect(tvChannelForDeck({ page: 'work', tape: 'a' }, null)).toEqual({ kind: 'insertTape' })
    expect(tvChannelForDeck({ page: 'work', tape: 'a' }, 'b')).toEqual({ kind: 'insertTape' })
    expect(tvChannelForDeck({ page: 'work', tape: 'a' }, 'a')).toEqual({ kind: 'tape', tape: 'a' })
    expect(tvChannelForDeck({ page: 'work' }, 'a')).toEqual({ kind: 'insertTape' })
    // Other pages keep the title card, with or without a tape in the VCR.
    expect(tvChannelForDeck({ page: 'home' }, 'a')).toEqual({ kind: 'home' })
  })

  it('compares channel keys', () => {
    expect(sameTvChannel({ kind: 'tape', tape: 'a' }, { kind: 'tape', tape: 'a' })).toBe(true)
    expect(sameTvChannel({ kind: 'tape', tape: 'a' }, { kind: 'tape', tape: 'b' })).toBe(false)
    expect(sameTvChannel({ kind: 'home' }, { kind: 'insertTape' })).toBe(false)
  })
})

describe('tape keys', () => {
  it('names the digit keys by shelf slot, compressing runs', () => {
    expect(slotKeys([1, 2, 3, 6])).toBe('1-3, 6')
    expect(slotKeys([8, 1, 2, 3, 4, 5, 6, 7])).toBe('1-8')
    expect(slotKeys([4])).toBe('4')
    expect(slotKeys([1, 3, 5], '–')).toBe('1, 3, 5')
    expect(slotKeys([2, 3, 7, 8], '–')).toBe('2–3, 7–8')
    expect(slotKeys([])).toBe('')
  })
})

describe('polaroid photo', () => {
  it('takes the first of jpg, jpeg, png, webp', () => {
    expect(pickPhotoUrl({})).toBeUndefined()
    expect(pickPhotoUrl({ '../../assets/photo.png': 'png' })).toBe('png')
    expect(pickPhotoUrl({ '../../assets/photo.webp': 'webp', '../../assets/photo.png': 'png' })).toBe('png')
    expect(pickPhotoUrl({ '../../assets/photo.png': 'png', '../../assets/photo.jpeg': 'jpeg' })).toBe('jpeg')
    expect(pickPhotoUrl({ '../../assets/photo.jpg': 'jpg', '../../assets/photo.jpeg': 'jpeg' })).toBe('jpg')
  })
})
