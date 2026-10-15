import { useStore } from './store'

/**
 * Switches the site to its readable HTML layer (plan §5.10): drops
 * `html.webgl` (styles/seo.css then shows #seo and lets the page scroll) and
 * sets phase 'fallback', which unmounts the 3D layer. Used without WebGL2,
 * when the 3D layer crashes, and when the WebGL context is lost for good.
 */
export function enterFallback(reason: string, error?: unknown, level: 'info' | 'warn' = 'info'): void {
  if (error !== undefined) console.error(`[fallback] ${reason}`, error)
  else console[level](`[fallback] ${reason}`)
  if (typeof document !== 'undefined') document.documentElement.classList.remove('webgl')
  useStore.getState().setPhase('fallback')
}

/** How long a lost WebGL context may take to come back before falling back. */
export const CONTEXT_RESTORE_MS = 2000

/**
 * Watches a container (capture phase, so events from its canvas are seen) for
 * `webglcontextlost`: asks the browser to restore it (preventDefault) and
 * calls `onGiveUp` if `webglcontextrestored` does not follow in time.
 */
export function watchContextLoss(target: EventTarget, onGiveUp: () => void, timeoutMs = CONTEXT_RESTORE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const onLost = (event: Event) => {
    event.preventDefault()
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      onGiveUp()
    }, timeoutMs)
  }
  target.addEventListener('webglcontextlost', onLost, true)
  target.addEventListener('webglcontextrestored', clear, true)
  return () => {
    clear()
    target.removeEventListener('webglcontextlost', onLost, true)
    target.removeEventListener('webglcontextrestored', clear, true)
  }
}
