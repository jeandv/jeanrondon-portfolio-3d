/**
 * Still capture (plan §1 Loader, §9 M5). Renders the home view once and writes
 *   public/still.jpg                   1920×1080 mozjpeg, quality tuned to ≤ 180 KB (the loader's LCP)
 *   public/og.jpg                      1200×630, cropped around the TV
 *   src/assets/still-calibration.json  { width, height, fov, tv: [[x, y] × 4] } in still pixels
 *
 * Starts its own Vite dev server on :5174 (separate deps cache, closed at the
 * end) and drives the system Microsoft Edge — or Chrome — through
 * playwright-core (no browser download), headless at 1920×1080, DPR 1, on
 * `/?capture` (src/capture/mode.ts: no chrome, no gate, frozen clocks).
 * Without a usable browser it exits non-zero and writes nothing; the loader
 * then runs in its "free" mode.
 */
/* global window, document -- used inside page.evaluate() callbacks, which run in the browser */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = {
  still: resolve(ROOT, 'public/still.jpg'),
  og: resolve(ROOT, 'public/og.jpg'),
  calibration: resolve(ROOT, 'src/assets/still-calibration.json'),
}

const WIDTH = 1920
const HEIGHT = 1080
const PORT = 5174
const STILL_MAX_BYTES = 180 * 1024
/** Open Graph card: 1200×630 cut from a region `zoom`× larger around the TV. */
const OG = { width: 1200, height: 630, zoom: 1.15, quality: 84 }
const CHANNELS = ['msedge', 'chrome']
const TIMEOUT_MS = 180_000

const firstLine = (error) => String(error instanceof Error ? error.message : error).split('\n')[0]
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`

async function launchBrowser() {
  const args = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
  if (process.platform === 'win32') args.push('--use-angle=d3d11')
  const failures = []
  for (const channel of CHANNELS) {
    try {
      return { browser: await chromium.launch({ channel, headless: true, args }), channel }
    } catch (error) {
      failures.push(`${channel}: ${firstLine(error)}`)
    }
  }
  throw new Error(`no system Microsoft Edge or Chrome could be launched:\n  ${failures.join('\n  ')}`)
}

function withTimeout(promise, ms, what) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s waiting for ${what}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Highest mozjpeg quality that fits the budget. */
async function encodeStill(png) {
  for (let quality = 90; quality >= 40; quality -= 2) {
    const jpg = await sharp(png).jpeg({ quality, mozjpeg: true, progressive: true, chromaSubsampling: '4:2:0' }).toBuffer()
    if (jpg.length <= STILL_MAX_BYTES) return { jpg, quality }
  }
  throw new Error(`still.jpg does not fit ${kib(STILL_MAX_BYTES)} even at quality 40`)
}

/** Pure: crop rectangle of the OG card, centred on the TV and kept inside the still. */
export function ogCrop(corners, width = WIDTH, height = HEIGHT, og = OG) {
  const cx = corners.reduce((sum, [x]) => sum + x, 0) / corners.length
  const cy = corners.reduce((sum, [, y]) => sum + y, 0) / corners.length
  const cropWidth = Math.min(width, Math.round(og.width * og.zoom))
  const cropHeight = Math.min(height, Math.round((cropWidth * og.height) / og.width))
  const clamp = (value, max) => Math.min(Math.max(0, Math.round(value)), max)
  return {
    left: clamp(cx - cropWidth / 2, width - cropWidth),
    top: clamp(cy - cropHeight / 2, height - cropHeight),
    width: cropWidth,
    height: cropHeight,
  }
}

function validCorners(corners) {
  return (
    Array.isArray(corners) &&
    corners.length === 4 &&
    corners.every(
      (point) =>
        Number.isFinite(point?.x) &&
        Number.isFinite(point?.y) &&
        point.x > -WIDTH &&
        point.x < 2 * WIDTH &&
        point.y > -HEIGHT &&
        point.y < 2 * HEIGHT,
    )
  )
}

async function capture(page) {
  const url = `http://localhost:${PORT}/?capture`
  await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT_MS })
  const webgl = await page.evaluate(() => document.documentElement.classList.contains('webgl'))
  if (!webgl) throw new Error('WebGL2 is not available in the headless browser')
  await page.waitForFunction(() => window.__capture !== undefined, null, { timeout: TIMEOUT_MS })
  await withTimeout(
    page.evaluate(() => window.__capture.ready),
    TIMEOUT_MS,
    'the capture to be ready (scene live, compiled, settled)',
  )
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  const corners = await page.evaluate(() => window.__capture.tvCorners())
  const fov = await page.evaluate(() => window.__capture.fov())
  if (!validCorners(corners)) throw new Error(`tv_screen corners look wrong: ${JSON.stringify(corners)}`)
  if (!(fov > 0 && fov < 180)) throw new Error(`camera FOV looks wrong: ${fov}`)
  const png = await page.screenshot({ type: 'png' })
  return { png, corners: corners.map(({ x, y }) => [x, y]), fov, renderer }
}

async function main() {
  let server
  let browser
  try {
    const launched = await launchBrowser()
    browser = launched.browser
    server = await createServer({
      root: ROOT,
      configFile: resolve(ROOT, 'vite.config.ts'),
      // Own deps cache: never touches the cache of a dev server already running on :5173.
      cacheDir: resolve(ROOT, 'node_modules/.vite-capture'),
      server: { port: PORT, strictPort: true, hmr: false },
      clearScreen: false,
      logLevel: 'warn',
    })
    await server.listen()
    console.log(`[capture] vite on :${PORT}, ${launched.channel} headless ${WIDTH}×${HEIGHT} @1x`)

    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      colorScheme: 'dark',
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => console.warn(`[capture] page error: ${firstLine(error)}`))
    page.on('console', (message) => {
      if (message.type() === 'error') console.warn(`[capture] console: ${message.text()}`)
    })

    const { png, corners, fov, renderer } = await capture(page)
    const meta = await sharp(png).metadata()
    if (meta.width !== WIDTH || meta.height !== HEIGHT) {
      throw new Error(`screenshot is ${meta.width}×${meta.height}, expected ${WIDTH}×${HEIGHT}`)
    }

    const still = await encodeStill(png)
    const crop = ogCrop(corners)
    const og = await sharp(png)
      .extract(crop)
      .resize(OG.width, OG.height, { kernel: 'lanczos3' })
      .jpeg({ quality: OG.quality, mozjpeg: true, progressive: true })
      .toBuffer()
    const round = (value) => Math.round(value * 100) / 100
    const calibration = {
      width: WIDTH,
      height: HEIGHT,
      fov: round(fov),
      tv: corners.map(([x, y]) => [round(x), round(y)]),
    }

    await mkdir(dirname(OUT.still), { recursive: true })
    await writeFile(OUT.still, still.jpg)
    await writeFile(OUT.og, og)
    await writeFile(OUT.calibration, `${JSON.stringify(calibration, null, 2)}\n`)

    console.log(`[capture] renderer: ${renderer}`)
    console.log(`[capture] ${relative(ROOT, OUT.still)}: ${WIDTH}×${HEIGHT}, q${still.quality}, ${kib(still.jpg.length)}`)
    console.log(`[capture] ${relative(ROOT, OUT.og)}: ${OG.width}×${OG.height} from ${crop.width}×${crop.height}@${crop.left},${crop.top}, ${kib(og.length)}`)
    console.log(`[capture] ${relative(ROOT, OUT.calibration)}: fov ${calibration.fov}°, tv ${JSON.stringify(calibration.tv)}`)
  } finally {
    await browser?.close().catch(() => undefined)
    await server?.close().catch(() => undefined)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`[capture] FAILED: ${error instanceof Error ? error.message : error}`)
    console.error('[capture] nothing was written; the loader keeps its "free" mode (no still / calibration).')
    process.exitCode = 1
  }
}
