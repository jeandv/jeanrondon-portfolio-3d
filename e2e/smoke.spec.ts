import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import sharp from 'sharp'
import { PROFILE } from '../src/content/profile'
import { TAPES } from '../src/content/work'
import { buttonUv } from '../src/screens/channels/cd/layout'
import { cvButtonUv } from '../src/screens/cvCardLayout'
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

/** The CV (it sends X-Frame-Options: DENY, so every entry point opens it in a new tab). Never loaded in tests. */
const CV_URL = 'https://rxresu.me/jeandv/cv-jean-rondon'
const CV_PILL_NAME = "Open Jean Rondón's CV (opens in a new tab)"

/**
 * Keeps the real CV off the network: every request to it is aborted (the popup
 * ends on an error page) and its URL is recorded, which is how the tests see
 * where a popup was headed. Context-wide, because a popup is not the page.
 */
async function blockCv(context: BrowserContext): Promise<string[]> {
  const requested: string[] = []
  await context.route('**/rxresu.me/**', (route) => {
    requested.push(route.request().url())
    return route.abort()
  })
  return requested
}

/** Waits for the popup that `open` triggers and closes it again; resolves once the CV was requested `count` times in all. */
async function expectCvPopup(page: Page, requested: string[], count: number, open: () => Promise<void>): Promise<void> {
  const popup = page.waitForEvent('popup')
  await open()
  const opened = await popup
  await expect.poll(() => requested.length).toBe(count)
  expect(requested.at(-1)).toBe(CV_URL)
  await opened.close()
}

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

/** Waits for the camera to land (a flight starts a frame after the view changes). */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(300)
  await expect(page.locator('body')).toHaveAttribute('data-flying', 'false', { timeout: 20_000 })
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

test('#online dials the BBS first; any key skips to the menu, whose last entry [4] opens the CV', async ({ page, context }) => {
  const requested = await blockCv(context)
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-bbs', 'off')
  await navLink(page, 'Online').click()
  // A fresh context: the full dial-up (sessionStorage), ~5 s unless skipped.
  await expect(body).toHaveAttribute('data-bbs', 'dialing')
  await page.keyboard.press('x')
  await expect(body).toHaveAttribute('data-bbs', 'menu', { timeout: 2_000 })
  // Three contact links, then the CV: key 4 opens it in a new tab.
  await expect(page.locator('.s-hintbar')).toContainText('1–4')
  await expectCvPopup(page, requested, 1, () => page.keyboard.press('4'))
  await expect(body).toHaveAttribute('data-bbs', 'menu')
  // Leaving #online hangs up.
  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-bbs', 'off')
})

test('the CV pill is a real link to the CV, in a new tab, beside SOUND', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const pill = page.getByRole('link', { name: CV_PILL_NAME })
  await expect(pill).toBeVisible()
  await expect(pill).toHaveText('CV')
  await expect(pill).toHaveAttribute('href', CV_URL)
  await expect(pill).toHaveAttribute('target', '_blank')
  await expect(pill).toHaveAttribute('rel', /noopener/)
  await expect(pill).toHaveClass(/\bs-pill\b/)
  // Never clicked here (the real page stays off the network); it sits in the pills row without touching SOUND.
  const sound = page.getByRole('button', { name: 'Sound off' })
  const [cvBox, soundBox] = await Promise.all([pill.boundingBox(), sound.boundingBox()])
  expect(cvBox).not.toBeNull()
  expect(soundBox).not.toBeNull()
  if (!cvBox || !soundBox) return
  expect(cvBox.height).toBe(soundBox.height)
  expect(cvBox.x + cvBox.width).toBeLessThanOrEqual(soundBox.x)
  // The old CREDITS toggle is gone.
  await expect(page.getByRole('button', { name: 'Credits' })).toHaveCount(0)
})

test('a click on the rolodex floats the CV card up; Esc puts it back', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await settled(page)
  await expect(body).toHaveAttribute('data-cv', 'closed')
  const point = await page.evaluate(() => window.__screenPoint?.('rolodex') ?? null)
  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.move(point.x, point.y)
  await expect(page.locator('.s-tooltip')).toHaveText('VIEW CV')
  await page.mouse.click(point.x, point.y)
  await expect(body).toHaveAttribute('data-cv', 'open')
  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-cv', 'closed')
  // Esc only filed the card away: still at the desk.
  await expect(body).toHaveAttribute('data-route', 'home')
})

test('the CV card\'s OPEN CV button (and Enter) open the CV in a new tab; a click elsewhere on the card puts it back', async ({ page, context }) => {
  const requested = await blockCv(context)
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await settled(page)
  const rolodex = await page.evaluate(() => window.__screenPoint?.('rolodex') ?? null)
  expect(rolodex).not.toBeNull()
  if (!rolodex) return
  await page.mouse.click(rolodex.x, rolodex.y)
  await expect(body).toHaveAttribute('data-cv', 'open')
  // The card floats up to the middle of the frame (damped, ~1 s).
  await page.waitForTimeout(1500)
  await page.mouse.move(4, 4)

  const { u, v } = cvButtonUv('wide')
  const button = await page.evaluate(([uu, vv]) => window.__screenPointUv?.('cv_card', uu, vv) ?? null, [u, v] as const)
  expect(button).not.toBeNull()
  if (!button) return
  await page.mouse.move(button.x, button.y)
  await expect(page.locator('.s-tooltip')).toHaveText('OPEN CV')
  await expectCvPopup(page, requested, 1, () => page.mouse.click(button.x, button.y))
  // The card stays up while the CV opens elsewhere.
  await expect(body).toHaveAttribute('data-cv', 'open')

  // Enter opens it too.
  await expectCvPopup(page, requested, 2, () => page.keyboard.press('Enter'))
  await expect(body).toHaveAttribute('data-cv', 'open')

  // Anywhere else on the card (its lower left, in the small print): PUT BACK CV, and the click files it away.
  const paper = await page.evaluate(() => window.__screenPointUv?.('cv_card', 0.08, 0.12) ?? null)
  expect(paper).not.toBeNull()
  if (!paper) return
  await page.mouse.move(paper.x, paper.y)
  await expect(page.locator('.s-tooltip')).toHaveText('PUT BACK CV')
  await page.mouse.click(paper.x, paper.y)
  await expect(body).toHaveAttribute('data-cv', 'closed')
  expect(requested).toHaveLength(2)
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

test('M flies to the CD player; it never plays on its own, a click on PLAY does; Esc returns and it keeps playing', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-camera-mode', 'route')
  await expect(body).toHaveAttribute('data-music', 'stopped')
  await page.keyboard.press('m')
  await expect(body).toHaveAttribute('data-camera-mode', 'cd')
  // A camera mode, not a route.
  await expect(body).toHaveAttribute('data-route', 'home')
  await expect(page.locator('.s-hintbar')).toContainText('play / pause')
  await settled(page)
  await page.waitForTimeout(1000)
  await expect(body).toHaveAttribute('data-music', 'stopped')

  const { u, v } = buttonUv('play')
  const point = await page.evaluate(([uu, vv]) => window.__screenPointUv?.('cd_display', uu, vv) ?? null, [u, v] as const)
  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.move(point.x, point.y)
  await expect(page.locator('.s-tooltip')).toHaveText('PLAY')
  await page.mouse.click(point.x, point.y)
  await expect(body).toHaveAttribute('data-music', 'playing')

  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-camera-mode', 'route')
  await expect(body).toHaveAttribute('data-route', 'home')
  await expect(body).toHaveAttribute('data-music', 'playing')
  // M again, then M leaves too.
  await page.keyboard.press('m')
  await expect(body).toHaveAttribute('data-camera-mode', 'cd')
  await page.keyboard.press('m')
  await expect(body).toHaveAttribute('data-camera-mode', 'route')
})

/** Hosts the YouTube integration may reach (only after PLAY on the Joji disc). */
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|doubleclick\.net)$/

/**
 * A stand-in for https://www.youtube.com/iframe_api (never the real thing in
 * tests): YT.Player swaps its target for a blank iframe of the requested size
 * and answers like the real player (ready, playing, a clock, volume, mute).
 */
const FAKE_IFRAME_API = `
(function () {
  var STATES = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  function Player(target, options) {
    var self = this;
    this.options = options;
    this.videoId = options.videoId;
    this.started = 0;
    this.volume = 100;
    this.muted = false;
    var iframe = document.createElement('iframe');
    iframe.title = 'Fake YouTube player';
    iframe.setAttribute('width', options.width || '640');
    iframe.setAttribute('height', options.height || '360');
    iframe.dataset.videoId = options.videoId;
    iframe.dataset.host = options.host || '';
    target.replaceWith(iframe);
    this.iframe = iframe;
    setTimeout(function () { options.events && options.events.onReady && options.events.onReady({ target: self }); }, 30);
  }
  Player.prototype.emit = function (state) {
    var self = this;
    setTimeout(function () { self.options.events.onStateChange({ target: self, data: state }); }, 20);
  };
  Player.prototype.playVideo = function () { this.started = Date.now(); this.emit(1); };
  Player.prototype.pauseVideo = function () { this.emit(2); };
  Player.prototype.stopVideo = function () { this.emit(-1); };
  Player.prototype.loadVideoById = function (id) { this.videoId = id; this.iframe.dataset.videoId = id; this.started = Date.now(); this.emit(3); this.emit(1); };
  Player.prototype.cueVideoById = function (id) { this.videoId = id; this.iframe.dataset.videoId = id; this.emit(5); };
  Player.prototype.seekTo = function () { this.started = Date.now(); };
  Player.prototype.getCurrentTime = function () { return this.started ? (Date.now() - this.started) / 1000 : 0; };
  Player.prototype.getDuration = function () { return 213; };
  Player.prototype.setVolume = function (v) { this.volume = v; this.iframe.dataset.volume = String(v); };
  Player.prototype.mute = function () { this.muted = true; this.iframe.dataset.muted = 'true'; };
  Player.prototype.unMute = function () { this.muted = false; this.iframe.dataset.muted = 'false'; };
  Player.prototype.destroy = function () { this.iframe.remove(); };
  window.YT = { loaded: 1, Player: Player, PlayerState: STATES };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
`

/** Clicks a key on the CD player's front strip (canvas hit rects, via the dev hook). */
async function pressCdButton(page: Page, button: Parameters<typeof buttonUv>[0]): Promise<void> {
  const { u, v } = buttonUv(button)
  const point = await page.evaluate(([uu, vv]) => window.__screenPointUv?.('cd_display', uu, vv) ?? null, [u, v] as const)
  expect(point).not.toBeNull()
  if (point) await page.mouse.click(point.x, point.y)
}

test('nothing talks to YouTube at boot (no script, no iframe, no cookies)', async ({ page }) => {
  const youtube: string[] = []
  page.on('request', (request) => {
    if (YOUTUBE_HOST.test(new URL(request.url()).hostname)) youtube.push(request.url())
  })
  await page.goto('/')
  await enterMuted(page)
  await page.keyboard.press('m')
  await expect(page.locator('body')).toHaveAttribute('data-camera-mode', 'cd')
  await page.waitForTimeout(1500)
  expect(youtube).toEqual([])
  await expect(page.locator('script[src*="youtube"]')).toHaveCount(0)
  await expect(page.locator('.s-miniplayer')).toHaveCount(0)
})

test('the Joji disc plays in the YouTube monitor (fake API): NEXT, VOL+ and × work', async ({ page }) => {
  const youtube: string[] = []
  page.on('request', (request) => {
    if (YOUTUBE_HOST.test(new URL(request.url()).hostname)) youtube.push(request.url())
  })
  await page.route('**/iframe_api', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_IFRAME_API }))
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await page.keyboard.press('m')
  await expect(body).toHaveAttribute('data-camera-mode', 'cd')
  await settled(page)
  await expect(page.locator('.s-hintbar')).toContainText('volume')
  await expect(body).toHaveAttribute('data-disc', 'tapes')

  // DISC swaps in disc 2; nothing loads until PLAY.
  await pressCdButton(page, 'disc')
  await expect(body).toHaveAttribute('data-disc', 'joji')
  expect(youtube).toEqual([])

  await pressCdButton(page, 'play')
  await expect(body).toHaveAttribute('data-music', 'playing')
  await expect(body).toHaveAttribute('data-cd-track', '1')
  const monitor = page.locator('.s-miniplayer')
  const player = monitor.locator('iframe')
  await expect(player).toBeVisible()
  await expect(player).toHaveAttribute('data-host', 'https://www.youtube-nocookie.com')
  // Muted entry: the player is muted too, at the shared volume.
  await expect(player).toHaveAttribute('data-muted', 'true')
  const box = await player.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(200)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(200)
  // Nothing covers it.
  const covered = await page.evaluate(() => {
    const frame = document.querySelector('.s-miniplayer iframe')
    if (!frame) return true
    const rect = frame.getBoundingClientRect()
    return [
      [rect.left + 4, rect.top + 4],
      [rect.right - 4, rect.top + 4],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + 4, rect.bottom - 4],
      [rect.right - 4, rect.bottom - 4],
    ].some(([x = 0, y = 0]) => document.elementFromPoint(x, y) !== frame)
  })
  expect(covered).toBe(false)
  await expect(monitor).toContainText('Joji — Glimpse of Us')
  await expect(monitor).toContainText('via YouTube')
  // Clear of the hint bar and the pills.
  const monitorBox = await monitor.boundingBox()
  for (const selector of ['.s-hintbar', '.s-pills', '.s-nav']) {
    const other = await page.locator(selector).boundingBox()
    if (!monitorBox || !other) continue
    const apart =
      monitorBox.x + monitorBox.width <= other.x ||
      other.x + other.width <= monitorBox.x ||
      monitorBox.y + monitorBox.height <= other.y ||
      other.y + other.height <= monitorBox.y
    expect(apart, selector).toBe(true)
  }

  await pressCdButton(page, 'next')
  await expect(body).toHaveAttribute('data-cd-track', '2')
  await expect(player).toHaveAttribute('data-video-id', 'K3Qzzggn--s')

  const volume = Number(await body.getAttribute('data-volume'))
  await pressCdButton(page, 'volup')
  await expect(body).toHaveAttribute('data-volume', String(Math.min(100, volume + 10)))
  await expect(player).toHaveAttribute('data-volume', String(Math.min(100, volume + 10)))

  // Leaving the close-up keeps it playing (and the monitor up).
  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-camera-mode', 'route')
  await expect(body).toHaveAttribute('data-music', 'playing')
  await expect(monitor).toBeVisible()

  // × ejects: the video stops and the player goes away.
  await page.getByRole('button', { name: 'Stop and remove the YouTube player' }).click()
  await expect(body).toHaveAttribute('data-music', 'stopped')
  await expect(page.locator('.s-miniplayer')).toHaveCount(0)
  // The only YouTube URL ever requested was the (stubbed) API script.
  expect(youtube.every((url) => url.endsWith('/iframe_api'))).toBe(true)
})

test('on a 390 × 844 phone the YouTube monitor is 200 × 200, beside the stacked pills', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/iframe_api', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_IFRAME_API }))
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await page.keyboard.press('m')
  await settled(page)
  await page.keyboard.press('d')
  await expect(body).toHaveAttribute('data-disc', 'joji')
  await page.keyboard.press('Space')
  await expect(body).toHaveAttribute('data-music', 'playing')
  const player = page.locator('.s-miniplayer iframe')
  const box = await player.boundingBox()
  expect(box?.width).toBe(200)
  expect(box?.height).toBe(200)
  const monitorBox = await page.locator('.s-miniplayer').boundingBox()
  const pills = await page.locator('.s-pills').boundingBox()
  const nav = await page.locator('.s-nav').boundingBox()
  expect((monitorBox?.x ?? 0) + (monitorBox?.width ?? 0)).toBeLessThanOrEqual(pills?.x ?? 0)
  expect((monitorBox?.y ?? 0) + (monitorBox?.height ?? 0)).toBeLessThanOrEqual(844)
  expect(monitorBox?.y ?? 0).toBeGreaterThan((nav?.y ?? 0) + (nav?.height ?? 0))
  await expect(page.getByRole('link', { name: CV_PILL_NAME })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sound off' })).toBeVisible()
  // Stacked in the corner beside the monitor: neither pill overlaps the other, the monitor or the nav.
  const cvPill = await page.getByRole('link', { name: CV_PILL_NAME }).boundingBox()
  const soundPill = await page.getByRole('button', { name: 'Sound off' }).boundingBox()
  expect(cvPill).not.toBeNull()
  expect(soundPill).not.toBeNull()
  if (cvPill && soundPill) {
    expect(cvPill.y + cvPill.height).toBeLessThanOrEqual(soundPill.y)
    expect(cvPill.x).toBeGreaterThanOrEqual((monitorBox?.x ?? 0) + (monitorBox?.width ?? 0))
    expect(soundPill.x).toBeGreaterThanOrEqual((monitorBox?.x ?? 0) + (monitorBox?.width ?? 0))
    expect(cvPill.x + cvPill.width).toBeLessThanOrEqual(390)
    expect(cvPill.y).toBeGreaterThan((nav?.y ?? 0) + (nav?.height ?? 0))
  }
  // S stops (ejects) from the keyboard too.
  await page.keyboard.press('s')
  await expect(body).toHaveAttribute('data-music', 'stopped')
  await expect(page.locator('.s-miniplayer')).toHaveCount(0)
})

test('the LED strip behind the desk cycles its colour on a click', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await settled(page)
  await expect(body).toHaveAttribute('data-led', 'violet')
  // The glow on the wall between the lamp's arm and the TV (the strip's hotspot).
  const point = await page.evaluate(() => window.__screenPointWorld?.(-0.33, 0.86, -0.388) ?? null)
  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.move(point.x, point.y)
  await expect(page.locator('.s-tooltip')).toHaveText('LED: VIOLET')
  await page.mouse.click(point.x, point.y)
  await expect(body).toHaveAttribute('data-led', 'teal')
  await expect(page.locator('.s-tooltip')).toHaveText('LED: TEAL')
})

test('hovering a poster names it', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  await settled(page)
  // The TypeScript poster right of the window (home view, 16:9).
  const point = await page.evaluate(() => window.__screenPointWorld?.(1.13, 1.44, -0.39) ?? null)
  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.move(point.x, point.y)
  await expect(page.locator('.s-tooltip')).toHaveText('TYPESCRIPT — TYPED JAVASCRIPT')
})

test('the calculator lifts on a click and computes 12+30=', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  await settled(page)
  const point = await page.evaluate(() => window.__screenPoint?.('calculator') ?? null)
  expect(point).not.toBeNull()
  if (!point) return
  await page.mouse.move(point.x, point.y)
  await expect(page.locator('.s-tooltip')).toHaveText('USE CALCULATOR')
  await page.mouse.click(point.x, point.y)
  await expect(body).toHaveAttribute('data-calc-up', 'up')
  await page.keyboard.type('12+30=')
  await expect(body).toHaveAttribute('data-calc', '42')
  // Esc clears it, a second Esc puts it down (still at the desk).
  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-calc', '0')
  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-calc-up', 'down')
  await expect(body).toHaveAttribute('data-route', 'home')
})

test('typing at the computer presses the keyboard caps', async ({ page }) => {
  await page.goto('/')
  await enterMuted(page)
  const body = page.locator('body')
  // Not at the computer: nothing is pressed.
  await page.keyboard.press('KeyQ')
  await expect(body).not.toHaveAttribute('data-last-cap', /./)
  await navLink(page, 'About').click()
  await expect(body).toHaveAttribute('data-route', 'about')
  await settled(page)
  await page.keyboard.press('KeyA')
  await expect(body).toHaveAttribute('data-last-cap', 'KeyA')
  await page.keyboard.press('Space')
  await expect(body).toHaveAttribute('data-last-cap', 'Space')
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
  // The CV: a visible link under the intro, a row in Online and a footer line in the HTML layer
  // (the pill is 3D-only chrome, hidden here).
  const cvLinks = page.locator(`#seo a[href="${CV_URL}"]`)
  await expect(cvLinks).toHaveCount(3)
  for (const link of await cvLinks.all()) {
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  }
  await expect(page.locator('.seo-cv-link')).toHaveText(/^CV/)
  await expect(page.locator('.s-pills')).toBeHidden()
  await expect(page.locator('.seo-credits')).toBeVisible()
  await expect(page.locator('.seo-footer a')).toBeVisible()
})

test('an unknown hash falls back to home', async ({ page }) => {
  await page.goto('/#nope')
  await expect(page.locator('body')).toHaveAttribute('data-route', 'home')
  await enterMuted(page)
  await expect(page.locator('body')).toHaveAttribute('data-route', 'home')
  await expect(liveRegion(page)).toHaveText('Viewing: Desk')
  await expect(page.locator('.s-nav-link[aria-current="page"]')).toHaveCount(0)
})
