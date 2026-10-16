/**
 * Asset manifest (plan §5.1: "el progreso cuenta bytes reales").
 *
 * Writes src/assets/sizes.json: the byte size of every binary asset under
 * src/assets, keyed by its path relative to src/assets ("models/room.glb",
 * "bake/desk_albedo.webp"). The loader sums these against the bytes three's
 * loaders report (src/boot/bytes.ts), so the bar tracks real downloads.
 * Runs at the start of `npm run build`; run it by hand after changing assets.
 */
import { readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = resolve(ROOT, 'src/assets')
const OUT_FILE = resolve(ASSETS, 'sizes.json')

/** Files three's loaders fetch at boot (JSON manifests, fonts and the still are not counted). */
const ASSET_EXTENSIONS = new Set(['.glb', '.gltf', '.bin', '.webp', '.png', '.jpg', '.jpeg', '.avif', '.ktx2', '.hdr'])

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

/**
 * Assets fetched after the room is live, never counted by the boot bar: the
 * optional lamp-off bakes (`bake/<group>_irrB[_m].webp`). The app picks them
 * up by name (src/three/materials/baked.ts); this list documents them.
 */
const DEFERRED = /(^|\/)[a-z]+_irrB(_m)?\.webp$/

export function isDeferredAsset(key) {
  return DEFERRED.test(key)
}

/** Pure: { files, deferred } sorted by key, so the JSON diff stays stable. */
export function buildManifest(entries) {
  const files = {}
  for (const [key, bytes] of [...entries].sort(([a], [b]) => a.localeCompare(b))) files[key] = bytes
  const deferred = Object.keys(files).filter(isDeferredAsset)
  return { generatedBy: 'scripts/asset-manifest.mjs', files, ...(deferred.length > 0 ? { deferred } : {}) }
}

async function main() {
  const entries = []
  for await (const path of walk(ASSETS)) {
    if (!ASSET_EXTENSIONS.has(extensionOf(path))) continue
    const key = relative(ASSETS, path).split(sep).join('/')
    entries.push([key, (await stat(path)).size])
  }
  const manifest = buildManifest(entries)
  await writeFile(OUT_FILE, `${JSON.stringify(manifest, null, 2)}\n`)
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0)
  const deferred = manifest.deferred?.length ?? 0
  console.log(
    `[asset-manifest] ${relative(ROOT, OUT_FILE)}: ${entries.length} file(s), ${(total / 1024).toFixed(1)} KiB` +
      (deferred > 0 ? ` (${deferred} lamp-off bake(s) load after live, outside the boot bar)` : ''),
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
