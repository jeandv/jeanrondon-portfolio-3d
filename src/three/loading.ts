import { DefaultLoadingManager, type LoadingManager } from 'three'
import { createByteTracker, type ByteTracker } from '../boot/bytes'
import { bootSignals } from '../boot/signals'

/**
 * Feeds the loader's network share (boot/progress.ts) from three's loaders:
 * DefaultLoadingManager reports each finished request, and loaders wrapped
 * with `trackLoaderBytes` (the GLB) also stream their byte progress.
 */

let tracker: ByteTracker | null = null

function publish(): void {
  if (tracker) bootSignals.getState().setNetwork(tracker.fraction())
}

/**
 * Starts tracking the boot assets (URL → expected bytes). Chains onto the
 * manager's existing handlers (drei's useProgress sets them on import).
 * Installs once; later calls are ignored.
 */
export function trackLoading(expected: ReadonlyMap<string, number>, manager: LoadingManager = DefaultLoadingManager): void {
  if (tracker) return
  const active = createByteTracker(expected)
  tracker = active
  const { onProgress, onError } = manager
  manager.onProgress = (url, loaded, total) => {
    active.end(url)
    publish()
    onProgress?.(url, loaded, total)
  }
  manager.onError = (url) => {
    // A failed request must not hold the bar back; the scene's error boundary handles the failure.
    active.end(url)
    publish()
    onError?.(url)
  }
}

type ProgressCallback = (event: ProgressEvent) => void

/** The `load(url, onLoad, onProgress, onError)` shape of three's loaders. */
export interface ProgressLoader {
  load(url: string, onLoad: (result: unknown) => void, onProgress?: ProgressCallback, onError?: (error: unknown) => void): void
}

const wrapped = new WeakSet<object>()

/** Wraps a loader's `load` so its streamed progress events count bytes (idempotent per loader). */
export function trackLoaderBytes(loader: ProgressLoader): void {
  if (wrapped.has(loader)) return
  wrapped.add(loader)
  const load = loader.load.bind(loader)
  loader.load = (url, onLoad, onProgress, onError) =>
    load(
      url,
      onLoad,
      (event) => {
        tracker?.progress(url, event.loaded)
        publish()
        onProgress?.(event)
      },
      onError,
    )
}
