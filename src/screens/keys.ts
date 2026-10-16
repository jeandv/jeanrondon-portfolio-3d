/**
 * Digit keys that play a tape (keys map to shelf slots, not list positions):
 * [1, 2, 3, 6] → "1-3, 6"; [1..8] → "1-8". Pure.
 */
export function slotKeys(slots: readonly number[], dash = '-'): string {
  const sorted = [...new Set(slots)].filter((slot) => Number.isInteger(slot)).sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let previous = start
  for (const slot of [...sorted.slice(1), Number.NaN]) {
    if (start === undefined || previous === undefined) break
    if (slot === previous + 1) {
      previous = slot
      continue
    }
    ranges.push(start === previous ? String(start) : `${start}${dash}${previous}`)
    start = slot
    previous = slot
  }
  return ranges.join(', ')
}
