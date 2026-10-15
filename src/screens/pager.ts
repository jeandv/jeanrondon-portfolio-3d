/**
 * `more`-style pager maths (pure). `top` is the first visible line; the last
 * page is clamped so it is always full, and paging past the end wraps to the top.
 */

export function maxTop(total: number, rows: number): number {
  return Math.max(0, total - rows)
}

export function clampTop(top: number, total: number, rows: number): number {
  return Math.min(Math.max(0, Math.round(top)), maxTop(total, rows))
}

export function isAtEnd(top: number, total: number, rows: number): boolean {
  return top >= maxTop(total, rows)
}

/** Space / PageDown: next page, or back to the top from the last one. */
export function pageDown(top: number, total: number, rows: number): number {
  return isAtEnd(top, total, rows) ? 0 : clampTop(top + rows, total, rows)
}

/** PageUp: previous page (stops at the top). */
export function pageUp(top: number, total: number, rows: number): number {
  return clampTop(top - rows, total, rows)
}

/** Arrow keys: scroll by `delta` lines (no wrapping). */
export function scrollBy(top: number, delta: number, total: number, rows: number): number {
  return clampTop(top + delta, total, rows)
}

/** Share of the text shown up to the bottom of the screen (0–100). */
export function percentShown(top: number, total: number, rows: number): number {
  if (total <= 0) return 100
  return Math.round((Math.min(total, top + rows) / total) * 100)
}

/** Status line: `-- MORE (45%) --`, or `-- END --` on the last page. */
export function pagerStatus(top: number, total: number, rows: number): string {
  return isAtEnd(top, total, rows) ? '-- END --' : `-- MORE (${percentShown(top, total, rows)}%) --`
}

/**
 * Typewriter: how many characters of each visible line to draw. Lines before
 * `typeFrom` are complete; from there on `revealed` characters are spent in
 * reading order.
 */
export function typedLengths(
  lines: readonly string[],
  top: number,
  rows: number,
  typeFrom: number,
  revealed: number,
): number[] {
  const out: number[] = []
  let budget = revealed
  for (let i = top; i < Math.min(lines.length, top + rows); i++) {
    const length = lines[i]?.length ?? 0
    if (i < typeFrom) {
      out.push(length)
      continue
    }
    const shown = Math.max(0, Math.min(length, budget))
    out.push(shown)
    // A line break costs one character, so blank lines still take a beat.
    budget -= length + 1
  }
  return out
}
