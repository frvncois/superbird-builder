// Base-vs-fired class conflict resolution for interactions, shared by the
// static exporter (which bakes an int-fxrm removal map for the site runtime)
// and the editor canvas (useRenderNode), so both surfaces toggle identically.
//
// Problem: an interaction recomputes a target's classes as base + toClasses.
// When both sets style the same property (hidden + flex, opacity-0 +
// opacity-100), the CASCADE decides the winner — and Tailwind's output order
// is arbitrary from the author's perspective (`.hidden` compiles after
// `.flex`, so a hidden→flex menu toggle silently never opens). The fix:
// while an interaction is fired, base classes that conflict with its
// toClasses are REMOVED instead of outweighed.
//
// Conflict detection is heuristic (the full style catalog is TS and can't
// ship in the 2.5 KB runtime): same variant prefix AND (both in the display
// group, or same property head — the class minus its trailing value
// segment). False negatives just fall back to today's cascade behavior.

const DISPLAY = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid',
  'inline-grid', 'table', 'contents', 'flow-root', 'hidden',
])

// a trailing segment that reads as a value: number (56, 1.5), arbitrary
// ([2rem]), fraction (1/2), or a scale keyword
const VALUE_TAIL = /^(\d+(\.\d+)?|\[.*\]|\d+\/\d+|px|full|none|auto|0|screen|fit|min|max)$/

/** variant prefix ('md:hover:') and base ('flex') of a class */
function splitVariant(cls) {
  const i = cls.lastIndexOf(':')
  return i === -1 ? ['', cls] : [cls.slice(0, i + 1), cls.slice(i + 1)]
}

/** the property head a class styles: 'opacity-50' → 'opacity',
 * 'max-h-[24rem]' → 'max-h', '-translate-y-6' → '-translate-y',
 * display keywords → 'display', everything else → itself */
function headOf(base) {
  if (DISPLAY.has(base)) return 'display'
  const at = base.lastIndexOf('-')
  if (at > 0 && VALUE_TAIL.test(base.slice(at + 1))) return base.slice(0, at)
  return base
}

/** true when two full class tokens style the same property at the same variant */
export function interactionConflict(a, b) {
  if (a === b) return false
  const [va, ba] = splitVariant(a)
  const [vb, bb] = splitVariant(b)
  return va === vb && headOf(ba) === headOf(bb)
}

/** the base tokens that must be removed while `firedClasses` applies */
export function conflictingBaseClasses(baseTokens, firedClasses) {
  const fired = String(firedClasses ?? '').split(/\s+/).filter(Boolean)
  return baseTokens.filter((t) => fired.some((f) => interactionConflict(t, f)))
}
