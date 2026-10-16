/**
 * Network bytes for the loader (plan §5.1: "el progreso cuenta bytes reales").
 * Expected sizes come from src/assets/sizes.json (scripts/asset-manifest.mjs),
 * keyed by the path under src/assets ("models/room.glb"). Loaded bytes come
 * from streamed loader progress (GLB) and from item completion (textures).
 */

/** Size assumed for a request that is not in the manifest. */
export const FALLBACK_BYTES = 256 * 1024

export interface AssetManifest {
  readonly files: Readonly<Record<string, number>>
}

function isManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== 'object' || !('files' in value)) return false
  const files: unknown = value.files
  return (
    !!files &&
    typeof files === 'object' &&
    Object.values(files).every((size) => typeof size === 'number' && Number.isFinite(size) && size >= 0)
  )
}

// A glob, so a missing manifest (first run) is an empty object, not a build error.
const MANIFEST_FILES = import.meta.glob<unknown>('../assets/sizes.json', { eager: true, import: 'default' })

/** Byte sizes of the boot assets, or none when the manifest was not generated. */
export const ASSET_SIZES: Readonly<Record<string, number>> = (() => {
  const manifest = Object.values(MANIFEST_FILES)[0]
  return isManifest(manifest) ? manifest.files : {}
})()

/** Manifest key of a source path: `../../assets/bake/x.webp` → `bake/x.webp`. */
export function assetKey(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const at = normalized.lastIndexOf('assets/')
  return at === -1 ? normalized.replace(/^\.?\//, '') : normalized.slice(at + 'assets/'.length)
}

/** Expected bytes for a manifest key (FALLBACK_BYTES when unknown). */
export function assetBytes(key: string, sizes: Readonly<Record<string, number>> = ASSET_SIZES): number {
  const size = sizes[key]
  return size !== undefined && size > 0 ? size : FALLBACK_BYTES
}

interface Item {
  expected: number
  loaded: number
  done: boolean
}

export interface ByteTracker {
  /** Streamed bytes of a request so far. */
  progress(url: string, loaded: number): void
  /** A request finished (or failed: it no longer holds the bar back). */
  end(url: string): void
  /** Loaded / expected bytes, 0..1. */
  fraction(): number
}

/**
 * Sums bytes over the expected boot assets (URL → bytes). Requests that are
 * not expected count with FALLBACK_BYTES once they report. Loaded bytes per
 * item never exceed its expected size and never go back.
 */
export function createByteTracker(expected: ReadonlyMap<string, number>, fallback = FALLBACK_BYTES): ByteTracker {
  const items = new Map<string, Item>()
  for (const [url, bytes] of expected) items.set(url, { expected: Math.max(1, bytes), loaded: 0, done: false })

  const itemFor = (url: string): Item => {
    let item = items.get(url)
    if (!item) {
      item = { expected: fallback, loaded: 0, done: false }
      items.set(url, item)
    }
    return item
  }

  return {
    progress(url, loaded) {
      const item = itemFor(url)
      if (item.done || !Number.isFinite(loaded)) return
      item.loaded = Math.min(item.expected, Math.max(item.loaded, loaded))
    },
    end(url) {
      const item = itemFor(url)
      item.done = true
      item.loaded = item.expected
    },
    fraction() {
      let loaded = 0
      let total = 0
      for (const item of items.values()) {
        loaded += item.loaded
        total += item.expected
      }
      return total > 0 ? loaded / total : 0
    },
  }
}
