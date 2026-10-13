import { describe, expect, it } from 'vitest'
import { parseHash, toHash, type Route } from './router'

describe('parseHash', () => {
  it.each([
    ['', 'home'],
    ['#', 'home'],
    ['#home', 'home'],
    ['#about', 'about'],
    ['#work', 'work'],
    ['#online', 'online'],
  ] as const)('%j → %s', (hash, page) => {
    expect(parseHash(hash)).toEqual({ page })
  })

  it.each(['#contact', '#github'])('aliases %s to online', (hash) => {
    expect(parseHash(hash)).toEqual({ page: 'online' })
  })

  it.each(['#nope', '#works', '#tape', '#__proto__', '#constructor', '#toString', 'garbage'])(
    'sends unknown hash %j home',
    (hash) => {
      expect(parseHash(hash)).toEqual({ page: 'home' })
    },
  )

  it('parses #work/<id>', () => {
    expect(parseHash('#work/company-one')).toEqual({ page: 'work', tape: 'company-one' })
  })

  it('tolerates a leading slash, case and whitespace', () => {
    expect(parseHash('#/WORK/Company-One ')).toEqual({ page: 'work', tape: 'company-one' })
    expect(parseHash('#/about')).toEqual({ page: 'about' })
  })

  it('ignores tape segments on pages other than work', () => {
    expect(parseHash('#about/company-one')).toEqual({ page: 'about' })
  })

  it('drops malformed tape ids', () => {
    expect(parseHash('#work/')).toEqual({ page: 'work' })
    expect(parseHash('#work/-bad')).toEqual({ page: 'work' })
    expect(parseHash('#work/a b')).toEqual({ page: 'work' })
    expect(parseHash('#work/..')).toEqual({ page: 'work' })
  })

  it('drops tape ids not present in the known set', () => {
    const ids = new Set(['company-one'])
    expect(parseHash('#work/company-one', ids)).toEqual({ page: 'work', tape: 'company-one' })
    expect(parseHash('#work/unknown', ids)).toEqual({ page: 'work' })
  })
})

describe('toHash', () => {
  it.each<[Route, string]>([
    [{ page: 'home' }, '#home'],
    [{ page: 'about' }, '#about'],
    [{ page: 'online' }, '#online'],
    [{ page: 'work' }, '#work'],
    [{ page: 'work', tape: 'project-one' }, '#work/project-one'],
  ])('%j → %s', (route, hash) => {
    expect(toHash(route)).toBe(hash)
  })

  it('round-trips through parseHash', () => {
    const route: Route = { page: 'work', tape: 'project-two' }
    expect(parseHash(toHash(route))).toEqual(route)
  })
})
