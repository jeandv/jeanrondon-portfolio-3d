/**
 * Bake textures (plan §6, `npm run assets:textures`).
 *
 * Reads Blender's bakes from blender/bake/*.png and writes the web versions
 * to src/assets/bake/, where src/three/materials/baked.ts picks them up (a
 * group switches to baked materials once BOTH of its maps exist):
 *   <group>_albedo.png → <group>_albedo.webp     (webp q85, at the albedo size)
 *   <group>_irrA.png   → <group>_irrA.webp       (lanczos3 2K → 1K, webp q92)
 *   <group>_irrB.png   → <group>_irrB.webp       optional "lamp off" bake, same as irrA;
 *                                                 loaded after the room is live (never in the boot bar)
 *   every output also gets a half-size `_m` variant for phones.
 * Then prints a size report against the budget (boot bakes ≤ 3 MB; irrB listed apart).
 *
 *   node scripts/textures.mjs [--in blender/bake] [--out src/assets/bake] [--clean]
 *
 * --clean empties the output folder first (stale groups would otherwise stay).
 * Run `npm run assets:manifest` afterwards (`npm run assets` does it) so the
 * loader counts the new bytes.
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Target sizes per bake group (plan §6 "Grupos de bake"); irradiance is baked at 2× and downsampled. */
export const BAKE_SIZES = {
  room: { albedo: 2048, irrA: 1024 },
  floor: { albedo: 1024, irrA: 1024 },
  desk: { albedo: 2048, irrA: 1024 },
  gear: { albedo: 2048, irrA: 1024 },
  shelf: { albedo: 1024, irrA: 512 },
  props: { albedo: 1024, irrA: 512 },
}

/** Desktop bake set budget (plan §7: bakes ≤ 3 MB). */
export const BAKE_BUDGET_BYTES = 3 * 1024 * 1024

const WEBP = {
  albedo: { quality: 85, effort: 6, smartSubsample: true },
  irrA: { quality: 92, effort: 6, smartSubsample: true },
  irrB: { quality: 92, effort: 6, smartSubsample: true },
}

/** Marker written by scripts/fake-bake.mjs next to synthetic bakes. */
const FAKE_MARKER = 'FAKE_BAKE.json'

const SOURCE = /^([a-z]+)_(albedo|irrA|irrB)\.png$/

/** Kinds every baked group needs; irrB (lamp off) is optional. */
export const REQUIRED_KINDS = ['albedo', 'irrA']
export const OPTIONAL_KINDS = ['irrB']

/** Pure: parses `<group>_<kind>.png` (null when it is not a bake file). */
export function parseBakeName(file) {
  const match = SOURCE.exec(file)
  if (!match) return null
  const [, group, kind] = match
  return { group, kind, known: Object.hasOwn(BAKE_SIZES, group) }
}

/** Pure: output size for a kind at full or phone (`_m`) resolution (irrB = the irrA size). */
export function targetSize(group, kind, mobile = false) {
  const size = BAKE_SIZES[group]?.[kind === 'irrB' ? 'irrA' : kind]
  if (!size) throw new Error(`no target size for ${group}_${kind}`)
  return mobile ? size / 2 : size
}

const rel = (path) => relative(ROOT, path).split(sep).join('/')
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`

async function listPngs(dir) {
  try {
    return (await readdir(dir)).filter((file) => file.toLowerCase().endsWith('.png')).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * One output: resize with lanczos3 into a square (UV-mapped textures are
 * stretched, never cropped), drop alpha (bakes are opaque), encode webp.
 */
async function encode(input, output, size, kind) {
  const info = await sharp(input)
    .resize(size, size, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .removeAlpha()
    .webp(WEBP[kind])
    .toFile(output)
  return info.size
}

async function main() {
  const { values } = parseArgs({
    options: {
      in: { type: 'string', default: 'blender/bake' },
      out: { type: 'string', default: 'src/assets/bake' },
      clean: { type: 'boolean', default: false },
    },
  })
  const inDir = resolve(ROOT, values.in)
  const outDir = resolve(ROOT, values.out)

  const files = await listPngs(inDir)
  if (files === null) {
    throw new Error(
      `${rel(inDir)}/ does not exist. Bake in Blender first and save the images there ` +
        '(blender/scripts/prep_bake.py sets //bake/<group>_<pass>.png); see docs/BLENDER.md.',
    )
  }
  if (await exists(resolve(inDir, FAKE_MARKER))) {
    console.warn(`[textures] NOTE: ${rel(inDir)} holds FAKE bakes from scripts/fake-bake.mjs (pipeline test only).`)
  }

  const sources = new Map()
  for (const file of files) {
    const parsed = parseBakeName(file)
    if (!parsed) {
      console.warn(`[textures] skipped ${file}: expected <group>_albedo.png or <group>_irrA.png`)
      continue
    }
    if (!parsed.known) {
      console.warn(`[textures] skipped ${file}: unknown group "${parsed.group}" (known: ${Object.keys(BAKE_SIZES).join(', ')})`)
      continue
    }
    const entry = sources.get(parsed.group) ?? {}
    entry[parsed.kind] = resolve(inDir, file)
    sources.set(parsed.group, entry)
  }
  if (sources.size === 0) {
    throw new Error(`no bake PNGs in ${rel(inDir)}/ (expected e.g. desk_albedo.png + desk_irrA.png [+ desk_irrB.png])`)
  }

  if (values.clean && (await exists(outDir))) {
    for (const file of await readdir(outDir)) {
      if (file.endsWith('.webp')) await rm(resolve(outDir, file))
    }
    console.log(`[textures] cleaned ${rel(outDir)}/`)
  }
  await mkdir(outDir, { recursive: true })

  const rows = []
  let desktop = 0
  let phone = 0
  let lampOff = 0
  for (const [group, kinds] of sources) {
    for (const kind of [...REQUIRED_KINDS, ...OPTIONAL_KINDS]) {
      const input = kinds[kind]
      if (!input) {
        if (REQUIRED_KINDS.includes(kind)) {
          console.warn(`[textures] ${group}: ${group}_${kind}.png is missing; the group stays greybox until both maps exist`)
        } else {
          console.log(`[textures] ${group}: no ${group}_irrB.png (lamp-off bake); the web dims irrA instead`)
        }
        continue
      }
      if (kind === 'irrB' && !kinds.irrA) {
        console.warn(`[textures] ${group}: ${group}_irrB.png without ${group}_irrA.png is ignored`)
        continue
      }
      const meta = await sharp(input).metadata()
      const full = targetSize(group, kind)
      if (meta.width !== meta.height) {
        console.warn(`[textures] ${basename(input)} is ${meta.width}×${meta.height}; bakes should be square (stretched to ${full}²)`)
      }
      if (kind !== 'albedo' && (meta.width ?? 0) < full * 2) {
        console.warn(`[textures] ${basename(input)} is ${meta.width}px; bake irradiance at ${full * 2}px so the 2→1 downsample cleans the noise`)
      }
      if (kind === 'albedo' && (meta.width ?? 0) < full) {
        console.warn(`[textures] ${basename(input)} is ${meta.width}px; it gets upscaled to ${full}px (bake it at ${full}px)`)
      }
      const fullBytes = await encode(input, resolve(outDir, `${group}_${kind}.webp`), full, kind)
      const phoneBytes = await encode(input, resolve(outDir, `${group}_${kind}_m.webp`), full / 2, kind)
      if (kind === 'irrB') lampOff += fullBytes
      else desktop += fullBytes
      phone += phoneBytes
      rows.push({
        file: `${group}_${kind}`,
        source: `${meta.width}×${meta.height}`,
        full: `${full}² ${kib(fullBytes)}`,
        phone: `${full / 2}² ${kib(phoneBytes)}`,
      })
    }
  }

  console.table(rows)
  const status = desktop <= BAKE_BUDGET_BYTES ? 'OK' : 'OVER BUDGET'
  console.log(`[textures] wrote ${rows.length * 2} file(s) to ${rel(outDir)}/`)
  console.log(`[textures] desktop boot set: ${mib(desktop)} of ${mib(BAKE_BUDGET_BYTES)} budget (${status})`)
  if (lampOff > 0) console.log(`[textures] lamp-off set (irrB, loaded after live): ${mib(lampOff)}`)
  console.log(`[textures] phone set (_m): ${mib(phone)}`)
  if (desktop > BAKE_BUDGET_BYTES) {
    console.warn('[textures] over budget: lower the albedo sizes in BAKE_SIZES or the webp quality, or move to KTX2 (plan §10).')
  }
  const groups = [...sources.keys()].filter((group) => sources.get(group).albedo && sources.get(group).irrA)
  const withLampOff = groups.filter((group) => sources.get(group).irrB)
  console.log(`[textures] baked groups: ${groups.join(', ') || 'none'} (lamp-off bake: ${withLampOff.join(', ') || 'none'})`)
  console.log('[textures] → run `npm run assets:manifest` next (or `npm run assets`).')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`[textures] FAILED: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
