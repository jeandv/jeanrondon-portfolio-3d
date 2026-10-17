import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import { PROFILE } from '../src/content/profile'
import { TAPES } from '../src/content/work'
import type { RenderInfoSnapshot } from '../src/three/dev/renderInfo'

/**
 * Smoke tests (plan §11.7) on the Vite dev server: boot → gate → live, the
 * hash router, deep links and the HTML-only site. One fresh browser context
 * per test, so the session never skips the gate.
 */

/** Known, harmless console output (anything else is a failure). */
const IGNORED_CONSOLE: readonly RegExp[] = [
  // R3F 9 creates a THREE.Clock in its store; three r183+ warns about it (see README).
  /THREE\.Clock: This module has been deprecated/,
  // Chromium's own WebGL performance notes on some drivers.
  /GL Driver Message/,
  /GPU stall due to ReadPixels/,
]

const BOOT_TIMEOUT = 90_000

function phaseIs(page: Page, phase: string) {
  return page.waitForFunction((expected) => document.documentElement.dataset.phase === expected, phase, {
    timeout: BOOT_TIMEOUT,
  })
}

/** Loader → gate → ENTER MUTED → live. */
async function enterMuted(page: Page): Promise<void> {
  await phaseIs(page, 'gate')
  await page.getByRole('button', { name: 'Enter muted' }).click()
  await phaseIs(page, 'live')
}

function navLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name, exact: true })
}

function liveRegion(page: Page) {
  return page.locator('p[role="status"][aria-live="polite"]')
}

test('loads without console errors or warnings', async ({ page }) => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return
    const text = message.text()
    if (!IGNORED_CONSOLE.some((pattern) => pattern.test(text))) problems.push(`${message.type()}: ${text}`)
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

  await page.goto('/')
  await enterMuted(page)
  // A few live frames (screens, post chain, rain) before judging.
  await page.waitForTimeout(1500)
  expect(problems).toEqual([])
})

test('the nav has About, Work and Online', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Sections' })
  await expect(nav.getByRole('link')).toHaveText(['About', 'Work', 'Online'])
  await expect(nav.getByRole('link', { name: 'Work' })).toHaveAttribute('href', '#work')
  await expect(page.getByRole('link', { name: PROFILE.name, exact: true }).first()).toBeVisible()
})

test('loader, then the gate; ENTER MUTED goes live with a visible canvas', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.s-loader')).toBeVisible()
  await phaseIs(page, 'gate')
  await expect(page.getByRole('button', { name: /Click to enter/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enter muted' })).toBeVisible()

  await page.getByRole('button', { name: 'Enter muted' }).click()
  await phaseIs(page, 'live')
  await expect(page.locator('.s-loader')).toHaveCount(0)
  await expect(page.locator('#s-still')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveClass(/\bstill\b/)

  const canvas = page.locator('.s-stage canvas')
  await expect(canvas).toBeVisible()
  await expect(page.locator('.s-stage')).toHaveCSS('opacity', '1')
  const box = await canvas.boundingBox()
  expect(box?.width).toBe(1280)
  expect(box?.height).toBe(720)

  // Muted entry: the pill says so, and the dev render hook sees a drawn scene.
  await expect(page.getByRole('button', { name: 'Sound off' })).toBeVisible()
  const info: RenderInfoSnapshot | undefined = await page.evaluate(() => window.__renderInfo?.())
  expect(info?.scene.calls ?? 0).toBeGreaterThan(0)

  // The composed frame is not black: one NaN pixel in the scene would be
  // spread over the whole frame by Bloom (the Film pass zeroes NaN).
  await page.waitForTimeout(800)
  const { channels } = await sharp(await canvas.screenshot()).stats()
  const mean = channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3
  expect(mean).toBeGreaterThan(20)
})

test('a hash change updates body[data-route] and the active pill', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  await expect(page.locator('body')).toHaveAttribute('data-route', 'home')

  await page.evaluate(() => (window.location.hash = '#about'))
  await expect(page.locator('body')).toHaveAttribute('data-route', 'about')
  await expect(navLink(page, 'About')).toHaveAttribute('aria-current', 'page')

  // Aliases resolve: #contact → online.
  await page.evaluate(() => (window.location.hash = '#contact'))
  await expect(page.locator('body')).toHaveAttribute('data-route', 'online')

  // Back/forward go through hashchange too.
  await page.goBack()
  await expect(page.locator('body')).toHaveAttribute('data-route', 'about')

  // Nav clicks route as well.
  await navLink(page, 'Work').click()
  await expect(page.locator('body')).toHaveAttribute('data-route', 'work')
  await expect(liveRegion(page)).toHaveText('Viewing: Work')
})

test('a #work/<tape> deep link plays that tape after entering', async ({ page }) => {
  const tape = TAPES[0]
  if (!tape) throw new Error('src/content/work.ts has no tapes')
  await page.goto(`/#work/${tape.id}`)
  await expect(page.locator('body')).toHaveAttribute('data-route', 'work')
  await enterMuted(page)

  await expect(page).toHaveURL(new RegExp(`#work/${tape.id}$`))
  await expect(page.locator('body')).toHaveAttribute('data-route', 'work')
  await expect(navLink(page, 'Work')).toHaveAttribute('aria-current', 'page')
  await expect(liveRegion(page)).toHaveText(`Viewing: Work — ${tape.title}`)
  // The tape flies off the shelf into the VCR once live (dev signal: body[data-tape-state]).
  await expect(page.locator('body')).toHaveAttribute('data-tape-state', 'playing')
  await expect(page.locator('body')).toHaveAttribute('data-vcr-tape', tape.id)
})

test('clicking the desk lamp switches it off and on', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-lamp', 'on')
  // Let the camera settle on the home frame, then click the lamp head where it is drawn.
  await page.waitForTimeout(500)
  const point = await page.evaluate(() => window.__screenPoint?.('lamp_head') ?? null)
  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.click(point.x, point.y)
  await expect(body).toHaveAttribute('data-lamp', 'off')
  await expect(page.locator('.s-tooltip')).toHaveText('LAMP ON')
  await page.mouse.click(point.x, point.y)
  await expect(body).toHaveAttribute('data-lamp', 'on')
})

test('#online dials the BBS first; any key skips to the menu', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-bbs', 'off')
  await navLink(page, 'Online').click()
  // A fresh context: the full dial-up (sessionStorage), ~5 s unless skipped.
  await expect(body).toHaveAttribute('data-bbs', 'dialing')
  await page.keyboard.press('x')
  await expect(body).toHaveAttribute('data-bbs', 'menu', { timeout: 2_000 })
  // Leaving #online hangs up.
  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-bbs', 'off')
})

test('the CREDITS pill floats the credits card up; Esc puts it back', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-credits', 'closed')
  await page.getByRole('button', { name: 'Credits' }).click()
  await expect(body).toHaveAttribute('data-credits', 'open')
  await expect(page.getByRole('button', { name: 'Credits' })).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-credits', 'closed')
  // Esc only filed the card away: still at the desk.
  await expect(body).toHaveAttribute('data-route', 'home')
})

test('clicking the coffee mug takes a sip', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-sips', '0')
  await page.waitForTimeout(500)
  const point = await page.evaluate(() => window.__screenPoint?.('coffee_mug') ?? null)
  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.move(point.x, point.y)
  await expect(page.locator('.s-tooltip')).toHaveText('TAKE A SIP')
  await page.mouse.click(point.x, point.y)
  await expect(body).toHaveAttribute('data-sips', '1')
})

test('?lite shows the readable HTML site and no canvas', async ({ page }) => {
  await page.goto('/?lite')
  await expect(page.locator('html')).toHaveAttribute('data-phase', 'fallback')
  await expect(page.locator('html')).not.toHaveClass(/\bwebgl\b/)
  await expect(page.getByRole('heading', { level: 1, name: PROFILE.name })).toBeVisible()
  for (const name of ['About', 'Work', 'Online']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
  }
  await expect(page.locator('#s-about, #s-work, #s-online')).toHaveCount(3)
  await expect(page.getByRole('link', { name: /^Play tape:/ })).toHaveCount(TAPES.length)
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.locator('.s-loader')).toHaveCount(0)
})

test('an unknown hash falls back to home', async ({ page }) => {
  await page.goto('/#nope')
  await expect(page.locator('body')).toHaveAttribute('data-route', 'home')
  await enterMuted(page)
  await expect(page.locator('body')).toHaveAttribute('data-route', 'home')
  await expect(liveRegion(page)).toHaveText('Viewing: Desk')
  await expect(page.locator('.s-nav-link[aria-current="page"]')).toHaveCount(0)
})
