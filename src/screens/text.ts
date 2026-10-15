/** Text layout helpers (pure; canvas measuring is injected). */

export type Measure = (text: string) => number

/** Monospace measure: width = characters × `charWidth`. */
export function monoMeasure(charWidth = 1): Measure {
  return (text) => text.length * charWidth
}

export function canvasMeasure(g: CanvasRenderingContext2D): Measure {
  return (text) => g.measureText(text).width
}

/**
 * Greedy word wrap. Keeps explicit newlines (an empty paragraph yields an
 * empty line) and hard-breaks words wider than `maxWidth`.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      let rest = word
      while (rest.length > 1 && measure(rest) > maxWidth) {
        let cut = rest.length - 1
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

/** Trims `text` with "..." until it fits `maxWidth`. */
export function ellipsize(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text
  let end = text.length
  while (end > 0 && measure(`${text.slice(0, end).trimEnd()}...`) > maxWidth) end--
  return `${text.slice(0, end).trimEnd()}...`
}

/**
 * Largest size in [min, max] (step 1px) at which `text` fits `maxWidth`;
 * `measureAt(size)` returns the width of the text at that size.
 */
export function fitSize(maxWidth: number, max: number, min: number, measureAt: (size: number) => number): number {
  for (let size = max; size > min; size--) {
    if (measureAt(size) <= maxWidth) return size
  }
  return min
}
