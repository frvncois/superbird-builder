/** a collapsed block: hides real lines (start, end], keeping the open line */
export interface FoldRange {
  start: number
  end: number
}

export interface FoldInfo {
  /** display line index → real line index */
  displayToReal: number[]
  /** real line index → display line index, or -1 when hidden */
  realToDisplay: number[]
  hidden: boolean[]
}

/** maps between full-code line indices and the folded display */
export function computeFold(fullCode: string, ranges: FoldRange[]): FoldInfo {
  const total = fullCode.split('\n').length
  const hidden = new Array<boolean>(total).fill(false)
  for (const r of ranges) {
    for (let i = r.start + 1; i <= r.end && i < total; i++) hidden[i] = true
  }
  const displayToReal: number[] = []
  const realToDisplay = new Array<number>(total).fill(-1)
  for (let i = 0; i < total; i++) {
    if (!hidden[i]) {
      realToDisplay[i] = displayToReal.length
      displayToReal.push(i)
    }
  }
  return { displayToReal, realToDisplay, hidden }
}

/** the folded view of the full code */
export function collapseCode(fullCode: string, ranges: FoldRange[]): string {
  if (!ranges.length) return fullCode
  const lines = fullCode.split('\n')
  const { displayToReal } = computeFold(fullCode, ranges)
  return displayToReal.map((i) => lines[i]).join('\n')
}

/** old line index → new line index (LCS alignment); -1 when unmatched */
function lineMap(oldLines: string[], newLines: string[]): number[] {
  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const map = new Array<number>(n).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      map[i] = j
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return map
}

/**
 * Reconstructs full code from an edited folded view: the hidden
 * segments are spliced back after their open line's new position.
 * The user can't edit hidden lines, so each segment is byte-preserved.
 */
export function expandCode(oldFull: string, ranges: FoldRange[], newDisplay: string): string {
  if (!ranges.length) return newDisplay
  const oldLines = oldFull.split('\n')
  const { displayToReal, realToDisplay } = computeFold(oldFull, ranges)
  const oldDisplay = displayToReal.map((i) => oldLines[i]!)
  const newLines = newDisplay.split('\n')
  const map = lineMap(oldDisplay, newLines)

  // each fold's hidden lines, anchored to its open line's display index
  const segments = ranges
    .map((r) => ({
      anchor: realToDisplay[r.start] ?? -1,
      lines: oldLines.slice(r.start + 1, r.end + 1),
    }))
    .filter((s) => s.anchor >= 0)

  const after = new Map<number, string[][]>()
  for (const seg of segments.sort((a, b) => a.anchor - b.anchor)) {
    // matched open line → its new position; edited-in-place open line
    // stays at the same display index, so fall back to the anchor itself
    const at =
      map[seg.anchor]! >= 0 ? map[seg.anchor]! : Math.min(seg.anchor, newLines.length - 1)
    const list = after.get(at) ?? []
    list.push(seg.lines)
    after.set(at, list)
  }

  const out: string[] = []
  for (let k = 0; k < newLines.length; k++) {
    out.push(newLines[k]!)
    for (const seg of after.get(k) ?? []) out.push(...seg)
  }
  return out.join('\n')
}
