/**
 * Fake bake (pipeline test, no Blender needed).
 *
 * Writes synthetic bakes for every bake group of the greybox GLB to
 * blender/bake/, exactly as Blender would name them:
 *   <group>_albedo.png  flat group color (+ a faint UV grid) at the albedo size
 *   <group>_irrA.png    cool moonlight gradient + a warm lamp spot, at 2× the
 *                       irradiance size (textures.mjs downsamples it, like a real bake)
 * The greybox's UV1 mirrors UV0 (every face spans 0..1), so the irradiance
 * pattern repeats per face: it checks the material path, not the lighting.
 *
 *   node scripts/fake-bake.mjs           generate (refuses to touch real bakes; --force to override)
 *   then: npm run assets:textures && npm run assets:manifest   → the app switches to baked mode
 *   node scripts/fake-bake.mjs --clean   remove the fake PNGs, their src/assets/bake/*.webp
 *                                        outputs and the marker; regenerate the asset manifest
 */
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { BAKE_SIZES } from './textures.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BAKE_DIR = resolve(ROOT, 'blender/bake')
const OUT_DIR = resolve(ROOT, 'src/assets/bake')
const GLB = resolve(ROOT, 'src/assets/models/room.glb')
const MARKER = resolve(BAKE_DIR, 'FAKE_BAKE.json')

/** Flat albedo per group (sRGB), close to the greybox colors. */
const ALBEDO = {
  room: [0x7b, 0x7d, 0x86],
  floor: [0x5b, 0x46, 0x36],
  desk: [0x8b, 0x5e, 0x3c],
  gear: [0x5c, 0x58, 0x52],
  shelf: [0x7a, 0x52, 0x36],
  props: [0x6b, 0x5a, 0x45],
}

/** Linear irradiance: moonlight (top → bottom gradient) + a ~2700 K lamp spot. */
const MOON = [0.2, 0.24, 0.34]
const LAMP = [0.75, 0.47, 0.24]
const SPOT = { u: 0.36, v: 0.42, sigma: 0.2 }

const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const toByte = (c) => Math.round(Math.min(1, Math.max(0, c)) * 255)
const rel = (path) => relative(ROOT, path).split(sep).join('/')
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`

function albedoPixels(size, [r, g, b]) {
  const data = Buffer.alloc(size * size * 3)
  const cell = size / 8
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Faint grid: shows that the map is sampled on UV1 and not flipped.
      const line = x % cell < 2 || y % cell < 2 ? 0.94 : 1
      const i = (y * size + x) * 3
      data[i] = Math.round(r * line)
      data[i + 1] = Math.round(g * line)
      data[i + 2] = Math.round(b * line)
    }
  }
  return data
}

function irradiancePixels(size) {
  const data = Buffer.alloc(size * size * 3)
  const twoSigma2 = 2 * SPOT.sigma * SPOT.sigma
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size
    const gradient = 0.7 + 0.3 * (1 - v)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const spot = Math.exp(-((u - SPOT.u) ** 2 + (v - SPOT.v) ** 2) / twoSigma2)
      const i = (y * size + x) * 3
      for (let c = 0; c < 3; c++) data[i + c] = toByte(linearToSrgb(MOON[c] * gradient + LAMP[c] * spot))
    }
  }
  return data
}

async function writePng(path, size, pixels) {
  const info = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toFile(path)
  return info.size
}

/** Bake groups present in the greybox GLB (node extras `bake`). */
async function greyboxGroups() {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const document = await io.read(GLB)
  const groups = new Set()
  for (const node of document.getRoot().listNodes()) {
    const bake = node.getExtras()?.bake
    if (typeof bake === 'string' && Object.hasOwn(BAKE_SIZES, bake)) groups.add(bake)
  }
  return [...groups].sort()
}

async function listDir(dir) {
  try {
    return await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function sizeOf(path) {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}

async function removeIfEmpty(dir) {
  if ((await listDir(dir)).length === 0) {
    await rmdir(dir).catch(() => undefined)
    return true
  }
  return false
}

function runManifest() {
  const result = spawnSync(process.execPath, [resolve(ROOT, 'scripts/asset-manifest.mjs')], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('scripts/asset-manifest.mjs failed')
}

async function generate(force) {
  const existing = (await listDir(BAKE_DIR)).filter((file) => file !== 'FAKE_BAKE.json')
  const marked = (await sizeOf(MARKER)) >= 0
  if (existing.length > 0 && !marked && !force) {
    throw new Error(
      `${rel(BAKE_DIR)}/ already holds files that are not fake bakes (${existing.join(', ')}). ` +
        'Refusing to overwrite real bakes; pass --force if you really mean it.',
    )
  }
  await mkdir(BAKE_DIR, { recursive: true })
  const groups = await greyboxGroups()
  if (groups.length === 0) throw new Error(`no node with a known \`bake\` extra in ${rel(GLB)}`)

  const files = {}
  const rows = []
  for (const group of groups) {
    const albedoSize = BAKE_SIZES[group].albedo
    const irrSize = BAKE_SIZES[group].irrA * 2
    const albedo = `${group}_albedo.png`
    const irr = `${group}_irrA.png`
    files[albedo] = await writePng(resolve(BAKE_DIR, albedo), albedoSize, albedoPixels(albedoSize, ALBEDO[group]))
    files[irr] = await writePng(resolve(BAKE_DIR, irr), irrSize, irradiancePixels(irrSize))
    rows.push({ group, albedo: `${albedoSize}² ${kib(files[albedo])}`, irrA: `${irrSize}² ${kib(files[irr])}` })
  }
  const marker = {
    generatedBy: 'scripts/fake-bake.mjs',
    note: 'Synthetic bakes for testing the pipeline. Remove with `node scripts/fake-bake.mjs --clean`.',
    files,
  }
  await writeFile(MARKER, `${JSON.stringify(marker, null, 2)}\n`)
  console.table(rows)
  console.log(`[fake-bake] wrote ${Object.keys(files).length} PNG(s) to ${rel(BAKE_DIR)}/ for: ${groups.join(', ')}`)
  console.log('[fake-bake] next: npm run assets:textures && npm run assets:manifest  (the app then renders in baked mode)')
  console.log('[fake-bake] undo: node scripts/fake-bake.mjs --clean')
}

async function clean() {
  let marker
  try {
    marker = JSON.parse(await readFile(MARKER, 'utf8'))
  } catch {
    throw new Error(`no ${rel(MARKER)}: nothing to clean (fake bakes are only removed via their marker)`)
  }
  const removed = []
  const kept = []
  for (const [file, bytes] of Object.entries(marker.files ?? {})) {
    const png = resolve(BAKE_DIR, file)
    const size = await sizeOf(png)
    if (size !== -1 && size !== bytes) {
      kept.push(file)
      continue
    }
    if (size !== -1) await rm(png)
    removed.push(rel(png))
    // Web outputs derived from a fake PNG (textures.mjs: full + _m).
    const base = file.replace(/\.png$/, '')
    for (const output of [`${base}.webp`, `${base}_m.webp`]) {
      const path = resolve(OUT_DIR, output)
      if ((await sizeOf(path)) >= 0) {
        await rm(path)
        removed.push(rel(path))
      }
    }
  }
  await rm(MARKER)
  for (const line of removed) console.log(`[fake-bake] removed ${line}`)
  if (kept.length > 0) console.warn(`[fake-bake] kept (changed since the fake bake, so probably real): ${kept.join(', ')}`)
  for (const dir of [BAKE_DIR, OUT_DIR]) {
    const gone = await removeIfEmpty(dir)
    console.log(`[fake-bake] ${rel(dir)}/ ${gone ? 'is empty (removed)' : `still has: ${(await listDir(dir)).join(', ')}`}`)
  }
  runManifest()
}

async function main() {
  const { values } = parseArgs({
    options: {
      clean: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  })
  if (values.clean) await clean()
  else await generate(values.force)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`[fake-bake] FAILED: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
