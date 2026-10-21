import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { activeLabel } from '../three/interaction/hotspots'

const OFFSET_X = 16
const OFFSET_Y = 20

/**
 * Hotspot tooltip. React only re-renders when the label changes; pointer
 * movement writes `style.transform` directly.
 */
export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null)
  const label = useStore(activeLabel)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onMove = (event: PointerEvent) => {
      const width = element.offsetWidth
      const flip = event.clientX + OFFSET_X + width > window.innerWidth - 8
      const x = flip ? event.clientX - OFFSET_X - width : event.clientX + OFFSET_X
      element.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(event.clientY + OFFSET_Y)}px, 0)`
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div ref={ref} className="s-tooltip" data-visible={label !== null && label !== ''} aria-hidden="true">
      {label}
    </div>
  )
}
