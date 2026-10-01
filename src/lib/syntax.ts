import type { ElementNode } from '@/types/editor'
import { ELEMENTS, createNode, isKnownElement, isLeafElement } from './elements'
import { isComponentType } from './components'
import { walkNodes } from './tree'

// tokens may carry an argument: :h1[title]:, :collection-list[post], :body[post]
// an arg may start with '@' to name a BUILT-IN source rather than a collection
// (:collection-list[@pages] iterates the site's own pages) — '@' is only ever
// read inside the brackets, so it never collides with the '@link' suffix
// and an optional link suffix: :h2:@item, :div@/about, :button@https://x
// args allow a dot for one-hop reference bindings: :h1[author.name]:
// a '(+)' after the arg slot is the styled marker — display-only, derived from
// node.classes; the group is non-capturing (and tolerates the mid-typing forms
// '(', '(+', '()') so it never reaches node.arg and never splits the token
// the arg's closing ']' is optional so an unclosed bracket mid-typing
// (':h1[:', ':h1[po:') keeps matching — the node stays in the tree and its
// identity/classes/content survive reconcile while the arg is being edited
// a '{+}' after the style marker is the interactions marker — same rules as
// '(+)' but derived from node.interactions; mid-typing '{', '{+', '{}' tolerated
// an optional CLIENT REF sits immediately after the element name, CSS-selector
// style: ':div#hero:', ':h1#title[field](+):', ':section#top' … 'section:'.
// It is code-owned like the arg (re-read on every parse, never node state) and
// emits NOTHING in the HTML — that's `htmlId`. Its job is addressing: agents get
// a stable handle that doesn't drift when lines move, and reconcile gets its
// strongest adoption signal. The trailing name is optional so the mid-typing
// form ':div#' stays ONE token, same philosophy as the unclosed '['.
// ONE definition of the grammar, shared by every head-anchored matcher below.
const REF = '(?:#(?<ref>[a-zA-Z][a-zA-Z0-9-]*)?)?'
/** the same slot, uncaptured — for head-anchored matchers that only need to
 * SKIP it. Exported so line-patching callers (setElementArg, setElementRef)
 * share this one definition instead of each re-spelling the ref grammar. */
export const REF_SLOT = '(?:#[a-zA-Z0-9-]*)?'
const NAME = '[a-zA-Z][a-zA-Z0-9-]*'
const ARG = '(?:\\[(?<arg>[a-z0-9.@+-]*)\\]?)?'
const MARKERS = '(?:\\(\\+?\\)?)?(?:\\{\\+?\\}?)?'
const LINK = '(?:@(?<link>\\S+))?'

// Slot order: ':' name '#ref' '[arg]' '(+)' '{+}' ':'(leaf) '@link'.
// Groups are NAMED — a new slot must never be able to shift an index out from
// under a consumer (`leaf[2]` silently becoming the ref instead of the arg).
const LEAF = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}:${LINK}$`) // :h1: or :Card: (+#ref +[arg] +@link)
export const OPEN = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}${LINK}$`) // :section or :Card (same slots)
export const CLOSE = /^([a-zA-Z][a-zA-Z0-9-]*):$/ // section: or Card: — close lines never carry a ref

/** the named slots of a LEAF/OPEN match. Every consumer reads the token through
 * this, so adding a slot is a change in exactly one place. */
function slots(m: RegExpMatchArray) {
  const g = m.groups as Record<string, string | undefined>
  return { name: g.name!, ref: g.ref, arg: g.arg, link: g.link }
}

/** the '#ref' a line's token carries, or undefined. Reads the code, not a node —
 * callers patching a line need this before the tree has been re-derived. */
export function refOf(line: string): string | undefined {
  const trimmed = line.trim()
  const m = trimmed.match(LEAF) ?? trimmed.match(OPEN)
  return m ? slots(m).ref : undefined
}

/** the same line with its '#ref' removed. No-ops on close lines and on lines
 * that never had one. */
export function withoutRef(line: string): string {
  return line.replace(new RegExp(`^(\\s*:${NAME})${REF_SLOT}`), '$1')
}

/** the '@target' suffix a node carries in code → its node.link value
 * ('item' is the current-entry sentinel, stored as '@item'; else verbatim) */
export function linkFromToken(target: string | undefined): string | undefined {
  if (!target) return undefined
  return target === 'item' ? '@item' : target
}

const tabs = (n: number) => '\t'.repeat(n)

/**
 * Splits a line's content into individual syntax tokens, including
 * glued ones: ':div:h1:' → [':div', ':h1:']. A trailing ':' only
 * closes a leaf when it isn't the start of the next token.
 */
export function lexLine(text: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i++
    if (i >= text.length) break
    let j = i
    if (text[j] === ':') {
      j++
      while (j < text.length && /[a-zA-Z0-9-]/.test(text[j]!)) j++
      if (text[j] === '#') {
        // client ref '#hero' — consumed even while still just '#', so
        // mid-typing never splits the token across lines
        j++
        while (j < text.length && /[a-zA-Z0-9-]/.test(text[j]!)) j++
      }
      if (text[j] === '[') {
        // optional argument: [title] — consumed even while still
        // unclosed, so mid-typing never splits the token across lines
        let k = j + 1
        while (k < text.length && /[a-z0-9.@+-]/.test(text[k]!)) k++
        j = text[k] === ']' ? k + 1 : k
      }
      if (text[j] === '(') {
        // styled marker '(+)' — like [arg], consumed even while incomplete
        j++
        if (text[j] === '+') j++
        if (text[j] === ')') j++
      }
      if (text[j] === '{') {
        // interactions marker '{+}' — same treatment
        j++
        if (text[j] === '+') j++
        if (text[j] === '}') j++
      }
      if (text[j] === ':' && !/[a-zA-Z]/.test(text[j + 1] ?? '')) j++ // leaf close
      // link suffix: @target stays glued to the token (like [arg])
      if (text[j] === '@') {
        j++
        while (j < text.length && !/\s/.test(text[j]!)) j++
      }
    } else {
      while (j < text.length && /[a-zA-Z0-9-]/.test(text[j]!)) j++
      if (text[j] === ':') j++ // close token
    }
    if (j === i) j++ // junk char, consume so we always advance
    tokens.push(text.slice(i, j))
    i = j
  }
  return tokens
}

// token head (indent + :name + optional [arg]) then the marker slot — the
// anchor for reading/rewriting a line's styled marker without touching the
// leaf ':' or '@link' tail
const TOKEN_HEAD = new RegExp(`^(\\s*:${NAME}${REF_SLOT}(?:\\[[a-z0-9.@+-]*\\])?)(\\(\\+?\\)?)?`)

/** the :body wrapper's open line — tolerates an arg and (possibly mid-typing)
 * style/interaction markers: ':body', ':body[post]', ':body(', ':body[post](+){+}'.
 * Every scaffold matcher must use this so a '(' typed on the body line can't
 * make the wrapper look damaged (which would respawn a fresh :body). */
// deliberately does NOT accept '#': a ref on ':body' is a diagnostic, not
// grammar. buildDocument/extractBodyArg/extractBodyDecor rebuild this line on
// every edit and would destroy one, and the body already has a stable identity.
export const isBodyOpenLine = (trimmed: string) => /^:body(?:$|[[({])/.test(trimmed)

/** the marker currently on the line's token: '(+)', or a mid-typing '(', '(+', '()' */
export function styleMarkerOf(line: string): string | undefined {
  return line.match(TOKEN_HEAD)?.[2] || undefined
}

/** the line's token has an unclosed '[' arg — an arg edit in progress */
export function hasOpenArgBracket(line: string): boolean {
  return new RegExp(`^\\s*:${NAME}${REF_SLOT}\\[[^\\]]*$`).test(line)
}

/** finalizes an unclosed '[' arg: non-empty → close it (':h1[po' → ':h1[po]'),
 * empty → remove it (':h1[:' → ':h1:'). No-ops on closed args and non-token
 * lines. The lookahead excludes arg chars too, so backtracking can never
 * split a CLOSED arg like '[title]' and re-close it mid-word. */
export function closeArgBracket(line: string): string {
  return line.replace(
    new RegExp(`^(\\s*:${NAME}${REF_SLOT})\\[([a-z0-9.@+-]*)(?![\\]a-z0-9.@+-])`),
    (_, head: string, arg: string) => (arg ? `${head}[${arg}]` : head),
  )
}

/** rewrites the line's styled marker: on → exactly '(+)', off → none.
 * No-ops on lines that don't start with an element token (close lines, @setup).
 * An existing '{+}' stays in the rest, so ordering '(+){+}' falls out for free. */
export function withStyleMarker(line: string, on: boolean): string {
  const m = line.match(TOKEN_HEAD)
  if (!m || !m[1]) return line
  const head = m[1]
  const rest = line.slice(head.length + (m[2]?.length ?? 0))
  return head + (on ? '(+)' : '') + rest
}

// like TOKEN_HEAD but the head swallows any (possibly incomplete) style
// marker, so the '{…}' interactions slot anchors right after it
const INT_HEAD = new RegExp(
  `^(\\s*:${NAME}${REF_SLOT}(?:\\[[a-z0-9.@+-]*\\])?(?:\\(\\+?\\)?)?)(\\{\\+?\\}?)?`,
)

/** the interactions marker currently on the line's token: '{+}', or a
 * mid-typing '{', '{+', '{}' */
export function interactionMarkerOf(line: string): string | undefined {
  return line.match(INT_HEAD)?.[2] || undefined
}

/** rewrites the line's interactions marker: on → exactly '{+}', off → none */
export function withInteractionMarker(line: string, on: boolean): string {
  const m = line.match(INT_HEAD)
  if (!m || !m[1]) return line
  const head = m[1]
  const rest = line.slice(head.length + (m[2]?.length ?? 0))
  return head + (on ? '{+}' : '') + rest
}

// the '[…]' slot doubles as the data marker: '[+]' means the element carries
// its own content/media (set via the Data panel or inline editing), while a
// real '[name]' is a collection-field binding and owns the slot outright
const DATA_HEAD = new RegExp(`^(\\s*:${NAME}${REF_SLOT})(\\[[a-z0-9.@+-]*\\]?)?`)

/** the data marker currently on the line's token — only '[+]' counts; a real
 * arg or a mid-typing '[' is not a marker */
export function dataMarkerOf(line: string): string | undefined {
  const slot = line.match(DATA_HEAD)?.[2]
  return slot === '[+]' ? slot : undefined
}

/** rewrites the line's data marker: on → exactly '[+]', off → none.
 * No-ops when the slot holds a real '[arg]' (bindings own the slot) or an
 * unclosed '[' (an arg edit in progress). */
export function withDataMarker(line: string, on: boolean): string {
  const m = line.match(DATA_HEAD)
  if (!m || !m[1]) return line
  const slot = m[2]
  if (slot && slot !== '[+]') return line
  const rest = line.slice(m[1].length + (slot?.length ?? 0))
  return m[1] + (on ? '[+]' : '') + rest
}

/**
 * Brings every token line's three display-only markers — '[+]' own data, '(+)'
 * styled, '{+}' interactions — back in step with the node state they mirror,
 * and returns the code (the SAME string when nothing moved).
 *
 * Pure, so it serves both the editor's live truth-sync on the active page and
 * whole-project operations on pages nobody has open. Component instance
 * subtrees are skipped: their style and interactions live on the master, so
 * these nodes carry none of their own to mark.
 */
export function applyNodeMarkers(code: string, elements: ElementNode[]): string {
  const lines = code.split('\n')
  let changed = false
  const visit = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      const at = node.line
      if (at !== undefined && lines[at] !== undefined) {
        let line = lines[at]!
        // an unclosed '[' is an arg edit in progress — the marker heads
        // can't anchor past it, so a write would land mid-token; skip
        if (!hasOpenArgBracket(line)) {
          // '[+]' marks own content/media; a real '[arg]' binding owns the
          // slot (withDataMarker no-ops on it). Body never carries one —
          // its slot is page-owned (collection template binding).
          if (node.type !== 'body' && node.arg === undefined) {
            const data = dataMarkerOf(line)
            // a slider's carousel config lives in the Data panel too, so it
            // earns the same marker as own content/media
            const want =
              !!node.content || !!node.src || !!node.svg || !!node.slider || node.hidden !== undefined
            if (want !== (data === '[+]')) line = withDataMarker(line, want)
          }
          const style = styleMarkerOf(line)
          if (style === undefined || style === '(+)') {
            const want = !!node.classes?.trim()
            if (want !== (style === '(+)')) line = withStyleMarker(line, want)
          }
          const inter = interactionMarkerOf(line)
          if (inter === undefined || inter === '{+}') {
            const want = !!node.interactions?.length || !!node.animations?.length
            if (want !== (inter === '{+}')) line = withInteractionMarker(line, want)
          }
          if (line !== lines[at]) {
            lines[at] = line
            changed = true
          }
        }
      }
      if (!isComponentType(node.type)) visit(node.children)
    }
  }
  visit(elements)
  return changed ? lines.join('\n') : code
}

/**
 * Enforces one syntax token per line AND forces indentation from the token
 * structure: every line is re-indented to its nesting depth — one deeper
 * after an open, one shallower before a close — so whatever tabs the author
 * typed are overridden by the true structure. Runs on body content only
 * (called from enforceDocument), which sits one level inside :body, so depth
 * starts at 1. Blank lines are dropped entirely: deleting a line's token
 * removes the line rather than leaving a stranded empty line behind. (The
 * empty-body placeholder is re-added by buildDocument.)
 */
// only real containers (block elements) and component instances open a level;
// leaf elements (:paragraph:, :h1:, …) and unrecognized names never do, so a
// half-typed leaf never makes the lines below it jump a level deeper
function opensDepth(name: string): boolean {
  return isComponentType(name) || (isKnownElement(name) && name !== 'body' && !isLeafElement(name))
}

export function normalizeSyntax(value: string): string {
  const out: string[] = []
  let depth = 1

  for (const original of value.split('\n')) {
    const trimmed = original.trim()
    if (!trimmed) continue // drop blank lines
    for (const token of lexLine(trimmed)) {
      const close = token.match(CLOSE)
      if (close && opensDepth(close[1]!)) depth = Math.max(1, depth - 1)
      out.push(tabs(depth) + token)
      const open = token.match(OPEN)
      if (open && opensDepth(slots(open).name)) depth += 1
    }
  }

  return out.join('\n')
}

/**
 * Parses the page syntax into an element tree.
 *
 *   :section        open
 *     :h1:          leaf (self-closing)
 *   section:        close
 *
 * Unknown element names and stray lines are ignored so the
 * tree stays valid while the user is mid-typing.
 */
export function parseSyntax(
  code: string,
  /** `parent` is the node this one is being appended to (null at the root) —
   * already adopted or freshly created, so reconcile can tell whether a
   * candidate is landing under the same parent it had before */
  adopt?: (line: number, type: string, parent: ElementNode | null) => ElementNode | null,
): ElementNode[] {
  const root: ElementNode[] = []
  const stack: ElementNode[] = []

  // children are collected OFF the nodes and only written back at the end,
  // and only where membership/order actually changed — adopted nodes keep
  // their children array identity, so reactive consumers (the canvas
  // renderers) don't re-render untouched subtrees on every reparse
  const built = new Map<ElementNode, ElementNode[]>()

  const append = (node: ElementNode) => {
    const parent = stack[stack.length - 1]
    ;(parent ? built.get(parent)! : root).push(node)
  }

  // reuses the existing node for this source position when the caller
  // can identify one — its children are rebuilt from the code below
  const nodeFor = (line: number, type: string): ElementNode => {
    const existing = adopt?.(line, type, stack[stack.length - 1] ?? null) ?? createNode(type)
    built.set(existing, [])
    return existing
  }

  const lines = code.split('\n')
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    for (const token of lexLine(lines[lineIndex]!.trim())) {
      const leaf = token.match(LEAF)
      if (leaf) {
        const { name, ref, arg, link } = slots(leaf)
        // known elements and component instances (:Card:) become nodes
        if (isKnownElement(name) || isComponentType(name)) {
          const node = nodeFor(lineIndex, name)
          node.line = node.endLine = lineIndex
          node.arg = arg && arg !== '+' ? arg : undefined
          // code-owned, exactly like arg: written unconditionally on every
          // parse, so deleting the '#ref' really does clear it
          node.ref = ref
          node.link = linkFromToken(link)
          append(node)
        }
        continue
      }
      const open = token.match(OPEN)
      if (open) {
        const { name, ref, arg, link } = slots(open)
        // built-ins and component blocks (:Card … Card:) open nodes
        if (isKnownElement(name) || isComponentType(name)) {
          const node = nodeFor(lineIndex, name)
          node.line = node.endLine = lineIndex
          node.arg = arg && arg !== '+' ? arg : undefined
          node.ref = ref
          node.link = linkFromToken(link)
          append(node)
          stack.push(node)
        }
        continue
      }
      const close = token.match(CLOSE)
      if (close) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i]!.type === close[1]) {
            for (let j = i; j < stack.length; j++) stack[j]!.endLine = lineIndex
            stack.length = i
            break
          }
        }
      }
    }
  }

  // anything left open stretches to the last line
  for (const node of stack) node.endLine = lines.length - 1

  // write children back, keeping the existing array identity when unchanged
  for (const [node, kids] of built) {
    const prev = node.children
    const same =
      prev && prev.length === kids.length && kids.every((child, i) => child === prev[i])
    if (!same) node.children = kids
  }

  return root
}

/**
 * Maps each line of the new code to the line of the old code it came from.
 * Lines that were inserted or rewritten have no mapping.
 *
 * Patience-style: byte-identical prefix/suffix are mapped directly, then
 * lines UNIQUE in both remainders anchor the alignment (longest increasing
 * subsequence keeps crossings out) and the segments between anchors recurse.
 * Plain LCS runs only inside segments with no anchors. A pure LCS over the
 * whole document is ambiguous on this DSL's highly repetitive lines (`:div`,
 * `div:`, …): a mid-document insertion could shift the alignment and pair
 * surviving nodes with the WRONG downstream lines, silently reassigning
 * their classes/content/bindings (the reconciler adopts by mapped line).
 */
/** a line reduced to what the author MEANS: display-only markers ('(+)',
 * '{+}', '[+]') and trailing whitespace stripped. The diff compares canonical
 * lines so a caller that submits marker-stripped code (markers are derived
 * state, so stripping them is a reasonable thing to do) still maps every
 * surviving line — raw comparison made every styled line a mismatch and
 * silently re-seated classes/content on the wrong nodes. */
function canonicalLine(line: string): string {
  return withDataMarker(withInteractionMarker(withStyleMarker(line, false), false), false).replace(
    /\s+$/,
    '',
  )
}

function lineMap(oldCode: string, newCode: string): Map<number, number> {
  const a = oldCode.split('\n').map(canonicalLine)
  const b = newCode.split('\n').map(canonicalLine)
  const map = new Map<number, number>()
  mapRange(a, b, 0, a.length, 0, b.length, map)
  return map
}

/** classic LCS alignment over a slice — the anchorless fallback */
function lcsRange(
  a: string[],
  b: string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  map: Map<number, number>,
) {
  const n = aHi - aLo
  const m = bHi - bLo
  if (n <= 0 || m <= 0) return
  // dp[i][j] = LCS length of a[aLo+i:aHi], b[bLo+j:bHi]
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[aLo + i] === b[bLo + j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[aLo + i] === b[bLo + j]) {
      map.set(bLo + j, aLo + i)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
}

function mapRange(
  a: string[],
  b: string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  map: Map<number, number>,
) {
  // byte-identical prefix/suffix map 1:1 — an insertion or removal in the
  // middle leaves everything around it exactly aligned
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    map.set(bLo, aLo)
    aLo++
    bLo++
  }
  while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) {
    aHi--
    bHi--
    map.set(bHi, aHi)
  }
  if (aLo >= aHi || bLo >= bHi) return

  // anchor on lines that appear exactly once on BOTH sides of the slice
  const occurrences = (lines: string[], lo: number, hi: number) => {
    const m = new Map<string, { n: number; at: number }>()
    for (let i = lo; i < hi; i++) {
      const e = m.get(lines[i]!)
      if (e) e.n++
      else m.set(lines[i]!, { n: 1, at: i })
    }
    return m
  }
  const inA = occurrences(a, aLo, aHi)
  const inB = occurrences(b, bLo, bHi)
  const pairs: Array<[number, number]> = [] // [aIdx, bIdx], in b order
  for (const [line, eb] of inB) {
    if (eb.n !== 1) continue
    const ea = inA.get(line)
    if (ea?.n === 1) pairs.push([ea.at, eb.at])
  }
  if (!pairs.length) return lcsRange(a, b, aLo, aHi, bLo, bHi, map)
  pairs.sort((x, y) => x[1] - y[1])

  // longest increasing subsequence on the a side — crossing anchors would
  // reorder the document, so only a consistent chain survives
  const tailAt: number[] = [] // tailAt[k] = pairs index ending a chain of length k+1
  const prev: number[] = new Array(pairs.length).fill(-1)
  for (let p = 0; p < pairs.length; p++) {
    const ai = pairs[p]![0]
    let lo = 0
    let hi = tailAt.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tailAt[mid]!]![0] < ai) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[p] = tailAt[lo - 1]!
    tailAt[lo] = p
  }
  const chain: Array<[number, number]> = []
  for (let p = tailAt.length ? tailAt[tailAt.length - 1]! : -1; p !== -1; p = prev[p]!) {
    chain.push(pairs[p]!)
  }
  chain.reverse()

  let prevA = aLo
  let prevB = bLo
  for (const [ai, bi] of chain) {
    mapRange(a, b, prevA, ai, prevB, bi, map)
    map.set(bi, ai)
    prevA = ai + 1
    prevB = bi + 1
  }
  mapRange(a, b, prevA, aHi, prevB, bHi, map)
}

/**
 * Re-derives the element tree from edited code WITHOUT recreating the
 * nodes: every element line that survived the edit keeps its node
 * object — id, classes, content, and any future per-node settings
 * travel with it. Only lines that were actually added produce new
 * nodes.
 *
 * `map` maps new line index → old line index. Callers that know the
 * exact line movement (e.g. drag reorder) pass it explicitly; code
 * edits leave it out and get a text-diff-derived map.
 *
 * `stats`, when provided, is filled with the reconcile outcome: how many
 * nodes kept their identity vs. were minted fresh — the only signal a
 * caller has that an edit unexpectedly severed node identity.
 */
export interface ReconcileStats {
  adopted: number
  created: number
  /** adopted nodes that landed under a DIFFERENT parent than they had, and so
   * had their carried state dropped (see `guardReparent`). Only nodes that were
   * actually carrying something are listed — stripping a blank node is a no-op.
   *
   * `dropped` is what the node was carrying, so a caller can put it back in one
   * edit rather than reconstructing it from memory. Wrapping a styled element in
   * a new div is the ordinary case, and re-applying its classes by hand (and
   * re-finding its binding ids) was the whole cost of it. */
  reparented?: {
    id: string
    type: string
    dropped?: {
      classes?: string
      content?: string
      src?: string
      interactionIds?: string[]
      animationIds?: string[]
    }
  }[]
}

/** the node-only state a node carries that is NOT derivable from the code.
 * Shared by the reparent guard and by callers that want a clean slate. */
export const NODE_STATE_KEYS = [
  'classes',
  'content',
  'src',
  'svg',
  'hidden',
  // an instance's picks. NOT part of the `[+]` marker: they sit on a `:Name`
  // wrapper line, which has never carried a marker and is matched bare in
  // several places
  'variants',
  'background',
  'htmlId',
  'attributes',
  'interactions',
  'animations',
  'locales',
  'listQuery',
  'entryId',
  'slider',
] as const

/** true when a node carries state that would be lost (or wrongly inherited) */
export function hasNodeState(node: ElementNode): boolean {
  return NODE_STATE_KEYS.some((key) => {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (value == null || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  })
}

/** drop everything a node carried, leaving the structure the code describes */
export function stripNodeState(node: ElementNode) {
  for (const key of NODE_STATE_KEYS) delete (node as unknown as Record<string, unknown>)[key]
}

/**
 * Every unique `#ref` in the code → the line and element type carrying it.
 * A ref used TWICE maps to null: an ambiguous ref gets no special treatment
 * (validateDocument flags it; reconcile just falls back to the line diff).
 */
function refLines(code: string): Map<string, { line: number; type: string } | null> {
  const found = new Map<string, { line: number; type: string } | null>()
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const token of lexLine(lines[i]!.trim())) {
      const m = token.match(LEAF) ?? token.match(OPEN)
      if (!m) continue
      const { name, ref } = slots(m)
      if (!ref) continue
      found.set(ref, found.has(ref) ? null : { line: i, type: name })
    }
  }
  return found
}

export function reconcile(
  oldCode: string,
  newCode: string,
  previous: ElementNode[],
  /** omit to derive the mapping from a line diff; pass one when you KNOW the
   * exact line movement (drag-reorder, paste, delete) */
  map?: Map<number, number>,
  stats?: ReconcileStats,
  opts: {
    /**
     * Refuse to carry state across a change of PARENT. A line diff can map an
     * old line onto a new one of the same type in a completely different part of
     * the tree — replacing one block with a similarly-shaped block silently
     * re-seated its classes, src and click bindings onto unrelated nodes (a modal
     * wrapper became a popup's content div, still `fixed inset-0 hidden`).
     *
     * The node is still ADOPTED (ids must stay stable for selection and for the
     * element summary callers get back); only its carried state is dropped, and
     * it is reported in `stats.reparented`.
     *
     * OFF by default, and callers that pass an explicit `map` should leave it off:
     * drag-reorder, paste, delete and wrap-in-div all re-parent deliberately and
     * already know the exact mapping.
     */
    guardReparent?: boolean
  } = {},
): ElementNode[] {
  // an explicit map is the caller's exact knowledge of how lines moved — the
  // ref pre-pass below only ever extends the DIFF-derived one
  const derived = map === undefined
  const lineMapping = map ?? lineMap(oldCode, newCode)

  // index the existing nodes by the line they live on, in token order
  const byOldLine = new Map<number, ElementNode[]>()
  // child id → parent id (null at the root), for the reparent guard
  const parentOf = new Map<string, string | null>()
  const indexTree = (nodes: ElementNode[], parentId: string | null) => {
    for (const node of nodes) {
      parentOf.set(node.id, parentId)
      indexTree(node.children ?? [], node.id)
    }
  }
  indexTree(previous, null)
  walkNodes(previous, (node) => {
    if (node.line === undefined) return
    const list = byOldLine.get(node.line) ?? []
    list.push(node)
    byOldLine.set(node.line, list)
  })

  // REF PRE-PASS — the point of refs. A line diff maps by TEXT, so moving a
  // ref'd element (especially among identical siblings, where LCS is weakest)
  // loses its identity. A ref that is unique on both sides and names the same
  // element type is a far stronger signal than any text alignment, so adopt by
  // it. Only lines the diff couldn't place are filled in, so a confident text
  // match is never overridden.
  if (derived) {
    const oldRefs = refLines(oldCode)
    const takenOldLines = new Set(lineMapping.values())
    for (const [ref, here] of refLines(newCode)) {
      if (!here || lineMapping.has(here.line)) continue // ambiguous, or already mapped
      const there = oldRefs.get(ref)
      // same ref AND same element type — a ref reused for a different element
      // is a new element, not a moved one
      if (!there || there.type !== here.type || takenOldLines.has(there.line)) continue
      lineMapping.set(here.line, there.line)
      takenOldLines.add(there.line)
    }
  }

  // old lines already accounted for — computed AFTER the ref pre-pass so the
  // same-line fallback below can't steal a node the ref already claimed
  const mappedOldLines = new Set(lineMapping.values())

  return parseSyntax(newCode, (line, type, parent) => {
    // in-place edits (chars typed on an element's own line) defeat the
    // text diff, so fall back to the same physical line — but only when
    // that old line wasn't matched elsewhere
    const oldLine = lineMapping.get(line) ?? (mappedOldLines.has(line) ? undefined : line)
    const candidates = oldLine === undefined ? undefined : byOldLine.get(oldLine)
    const at = candidates?.findIndex((n) => n.type === type) ?? -1
    if (at === -1) {
      if (stats) stats.created++
      return null
    }
    if (stats) stats.adopted++
    const node = candidates!.splice(at, 1)[0]!
    // A newly CREATED parent has an id that was never in `previous`, so a node
    // landing under one is reparented by definition — which is exactly the case
    // that used to corrupt silently.
    if (opts.guardReparent && parentOf.get(node.id) !== (parent?.id ?? null)) {
      if (hasNodeState(node)) {
        stats?.reparented?.push({
          id: node.id,
          type: node.type,
          dropped: {
            ...(node.classes ? { classes: node.classes } : {}),
            ...(node.content ? { content: node.content } : {}),
            ...(node.src ? { src: node.src } : {}),
            ...(node.interactions?.length
              ? { interactionIds: node.interactions.map((b) => b.interactionId) }
              : {}),
            ...(node.animations?.length
              ? { animationIds: node.animations.map((b) => b.animationId) }
              : {}),
          },
        })
        stripNodeState(node)
      }
    }
    return node
  })
}

/** list sources that are not collections: `:collection-list[@pages]` repeats
 * over the site's own published pages (see shared/fields.pagesListScope) */
export const BUILTIN_LIST_SOURCES = ['@pages']

// --- validation ---

export interface Diagnostic {
  /** 0-based line index of the unclosed element */
  line: number
  message: string
}

/** Flags unclosed elements, unknown components, and unknown collections */
export function validateDocument(
  code: string,
  componentNames: string[] = [],
  collectionNames: string[] = [],
  /** multi-reference / multi-image field names — also valid as :collection-list args */
  listFieldNames: string[] = [],
  /** collections with `detailRoutes: false` — they render inside other pages
   * and own no route, so an `@item` link inside one points nowhere */
  dataOnlyCollections: string[] = [],
): Diagnostic[] {
  const lines = code.split('\n')
  const trimmed = lines.map((l) => l.trim())
  const start = trimmed.findIndex(isBodyOpenLine)
  const end = trimmed.lastIndexOf('body:')

  const diags: Diagnostic[] = []

  // a ref on ':body' is not grammar — buildDocument rebuilds that line on every
  // edit and would silently eat it, and the body already has a stable identity.
  // Checked before the scaffold bail-out below, because ':body#x' is exactly
  // what makes isBodyOpenLine miss and the whole body look damaged.
  const bodyRef = trimmed.findIndex((l) => /^:body#/.test(l))
  if (bodyRef !== -1) {
    diags.push({
      line: bodyRef,
      message: "':body' can't carry a '#ref' — it is the page root and is already addressable",
    })
  }
  if (start === -1 || end <= start) return diags

  const stack: { type: string; line: number; indent: number; arg?: string }[] = []
  /** every '#ref' seen so far → the line that claimed it, for the duplicate check */
  const refAt = new Map<string, number>()

  for (let i = start + 1; i < end; i++) {
    const lineTokens = lexLine(trimmed[i]!)
    if (!lineTokens.length) continue
    const indent = lines[i]!.length - lines[i]!.trimStart().length

    // indentation-consistency: a line at (or above) an open container's own
    // indent means that container's block has ended — if this line isn't its
    // closer, the container was never closed and would silently swallow every
    // following sibling (the parser builds structure from tokens alone, so a
    // childless ':div' before a sibling-level 'div:' steals that closer and
    // stays open). The classic trigger is the documented decorative-dot
    // pattern: an empty ':div' must be followed by its own 'div:'.
    const firstClose = lineTokens[0]!.match(CLOSE)
    while (stack.length) {
      const top = stack[stack.length - 1]!
      if (indent > top.indent) break
      if (firstClose && firstClose[1] === top.type && indent <= top.indent) break
      diags.push({
        line: top.line,
        message:
          `':${top.type}' is never closed — line ${i + 1} returns to its indentation level ` +
          `before a matching '${top.type}:'. Add '${top.type}:' after its children ` +
          `(for an empty decorative container, put '${top.type}:' on the very next line)`,
      })
      stack.pop()
    }

    for (const token of lineTokens) {
      const leaf = token.match(LEAF)
      const open = token.match(OPEN)
      const close = token.match(CLOSE)
      const part = leaf ? slots(leaf) : open ? slots(open) : null
      const name = part?.name

      if (part?.ref) {
        // refs are page-scope addresses, so a second use makes both ambiguous
        // (reconcile refuses to adopt by an ambiguous ref, and an agent
        // addressing by it can't be told which element it meant)
        const first = refAt.get(part.ref)
        if (first !== undefined) {
          diags.push({
            line: i,
            message: `'#${part.ref}' is already used on line ${first + 1} — refs must be unique on a page`,
          })
        } else {
          refAt.set(part.ref, i)
        }
        // inside a component instance the structure is a CLONE of the master,
        // rewritten into every instance on every page — a ref there would
        // duplicate across all of them. The instance's own open line is fine:
        // that node is a real page node (it isn't on the stack yet here).
        const inInstance = stack.find((sc) => componentNames.includes(sc.type))
        if (inInstance) {
          diags.push({
            line: i,
            message:
              `'#${part.ref}' is inside the ':${inInstance.type}' component block — refs are ` +
              `page-scope, and a component's structure is copied into every instance. Put the ` +
              `ref on the ':${inInstance.type}' line instead.`,
          })
        }
      }

      // collection embeds — the arg must name a real collection (a list may
      // also name a multi-reference/multi-image field it iterates)
      if (name === 'collection-list' || name === 'collection-item') {
        const arg = part?.arg
        const known =
          !!arg &&
          (collectionNames.includes(arg) ||
            // built-in list sources ('@pages' — the site's own pages)
            (name === 'collection-list' && BUILTIN_LIST_SOURCES.includes(arg)) ||
            (name === 'collection-list' && listFieldNames.includes(arg)))
        if (!known) {
          diags.push({ line: i, message: `Unknown collection ':${name}[${arg ?? ''}]'` })
        } else if (open) {
          stack.push({ type: name, line: i, indent, arg })
        }
        continue
      }

      // a slider's arg is OPTIONAL — with one it repeats per entry like a
      // :collection-list, without one each direct child is a slide. It pushes
      // its arg so `@item` diagnostics work inside a bound slider.
      if (name === 'slider') {
        const arg = part?.arg
        if (
          arg &&
          !collectionNames.includes(arg) &&
          !BUILTIN_LIST_SOURCES.includes(arg) &&
          !listFieldNames.includes(arg)
        ) {
          diags.push({ line: i, message: `Unknown collection ':slider[${arg}]'` })
        } else if (leaf) {
          diags.push({ line: i, message: "':slider:' is a container — open it as ':slider … slider:'" })
        } else if (open) {
          stack.push({ type: name, line: i, indent, arg })
        }
        continue
      }

      // `@item` links to the entry's own page — which a data-only collection
      // does not have. Caught here rather than silently rendering unlinked.
      if (linkFromToken(part?.link) === '@item') {
        const scope = [...stack].reverse().find((s) => s.arg && collectionNames.includes(s.arg))
        if (scope && dataOnlyCollections.includes(scope.arg!)) {
          diags.push({
            line: i,
            message:
              `'@item' links to an entry's own page, but the collection '${scope.arg}' has no ` +
              'detail routes (detailRoutes: false). Remove the link, or give the collection a ' +
              'template page.',
          })
        }
      }

      // component instances (capitalized) — must be a known component
      if (name && isComponentType(name)) {
        if (!componentNames.includes(name)) {
          diags.push({ line: i, message: `Unknown component ':${name}${leaf ? ':' : ''}'` })
        } else if (stack.some((s) => s.type === name)) {
          diags.push({ line: i, message: `':${name}${leaf ? ':' : ''}' can't contain itself` })
        } else if (open) {
          stack.push({ type: name, line: i, indent })
        }
        continue
      }

      // built-in elements — a leaf element is ALWAYS `:name:`; a container is
      // ALWAYS `:name … name:`. Using the wrong form is an error.
      if (name && isKnownElement(name) && name !== 'body') {
        if (open && isLeafElement(name)) {
          diags.push({ line: i, message: `':${name}' is a leaf — write it as ':${name}:'` })
        } else if (leaf && !isLeafElement(name)) {
          diags.push({ line: i, message: `':${name}:' is a container — open it as ':${name} … ${name}:'` })
        } else if (open) {
          stack.push({ type: name, line: i, indent })
        }
        continue
      }

      // a close token settles the nearest matching open
      if (close) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j]!.type === close[1]) {
            stack.length = j
            break
          }
        }
        continue
      }

      // nothing above matched → not a valid token (garbage, typo, or a
      // half-typed element name); flag it so the editor catches it live
      diags.push({ line: i, message: `Invalid syntax '${token}'` })
    }
  }

  return diags
    .concat(stack.map((s) => ({ line: s.line, message: `Close ':${s.type}' with '${s.type}:'` })))
    .sort((a, b) => a.line - b.line)
}

// --- suggestions ---

interface Context {
  stack: { type: string; indent: number; arg?: string }[]
  last: { kind: 'open' | 'close' | 'leaf'; type: string; indent: number } | null
}

function analyze(before: string): Context {
  const stack: Context['stack'] = []
  let last: Context['last'] = null

  for (const raw of before.split('\n')) {
    const indent = raw.match(/^\t*/)![0].length
    for (const token of lexLine(raw.trim())) {
      const leaf = token.match(LEAF)
      if (leaf) {
        last = { kind: 'leaf', type: slots(leaf).name, indent }
        continue
      }
      const open = token.match(OPEN)
      if (open) {
        const { name, arg } = slots(open)
        if (isKnownElement(name) || isComponentType(name)) stack.push({ type: name, indent, arg })
        last = { kind: 'open', type: name, indent }
        continue
      }
      const close = token.match(CLOSE)
      if (close) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i]!.type === close[1]) {
            stack.length = i
            break
          }
        }
        last = { kind: 'close', type: close[1]!, indent }
      }
    }
  }

  return { stack, last }
}

/** Elements that carry content/void render as leaves (:h1:), the rest open a block (:div) */
function tokenFor(type: string): string {
  return isLeafElement(type) ? `:${type}:` : `:${type}`
}

/**
 * Dedented source lines for a brand-new element of the given type. A seeded
 * container (a button, a link) is born holding its child, so an insert lands
 * something visible rather than an empty box — the child's TEXT is node state
 * and is applied by the caller (`applySeedContent`), not carried by the code.
 */
export function elementBlockLines(type: string): string[] {
  const token = tokenFor(type)
  if (token.endsWith(':')) return [token]
  const seed = ELEMENTS[type]?.seed
  if (seed) return [token, `\t${tokenFor(seed.type)}`, `${type}:`]
  return [token, `${type}:`]
}

/**
 * Suggests the next full line (indent included) for an empty line,
 * following the natural authoring flow: open a section → fill it →
 * close it back up.
 */
export function suggestNextLine(before: string): string | null {
  const { stack, last } = analyze(before)

  const top = stack[stack.length - 1]
  if (!top) return ':section'

  // just opened an element → suggest its first child (from the element
  // registry's `suggest` metadata, falling back to a heading)
  if (last?.kind === 'open') {
    const childIndent = tabs(last.indent + 1)
    const child = ELEMENTS[last.type]?.suggest
    return `${childIndent}${child ? tokenFor(child) : ':h1:'}`
  }

  // after a heading → a paragraph usually follows
  if (last?.kind === 'leaf' && /^(h[1-6]|heading)$/.test(last.type)) {
    return `${tabs(last.indent)}:paragraph:`
  }

  // body never closes from suggestions — offer the next section instead
  if (top.type === 'body') return `${tabs(top.indent + 1)}:section`

  // otherwise wind the tree back up: close the innermost open element
  return `${tabs(top.indent)}${top.type}:`
}

/**
 * Suggests the completed line for what the user is currently typing.
 * Returns the full line (indent included) or null. Falls back from
 * the contextual flow suggestion to registry-name completion and
 * close-tag completion.
 */
export function suggestCompletion(
  before: string,
  currentLine: string,
  componentNames: string[] = [],
  opts: { pages?: string[]; onTemplate?: boolean } = {},
): string | null {
  // blank line (or matching indent) → the contextual flow suggestion
  const flow = suggestNextLine(before)
  if (flow && flow.startsWith(currentLine) && flow !== currentLine) return flow

  const indent = currentLine.match(/^\t*/)![0]
  const typed = currentLine.trim()
  if (!typed) return null

  // typing a link suffix '…@partial' on a complete token → suggest a target:
  // 'item' (current entry, only in an entry scope), a page path, or a scheme
  const linkTyped = typed.match(/^(.*?[^@\s])@([^\s@]*)$/)
  if (linkTyped) {
    const [, prefix, partial] = linkTyped as unknown as [string, string, string]
    // prefix must be a complete leaf (:x:) or open (:x) token
    if (LEAF.test(prefix) || OPEN.test(prefix)) {
      const inEntryScope =
        !!opts.onTemplate ||
        analyze(before).stack.some(
          (s) => s.type === 'collection-list' || (s.type === 'slider' && !!s.arg),
        )
      const targets = [
        ...(inEntryScope ? ['item'] : []),
        ...(opts.pages ?? []),
        'https://',
        'mailto:',
        'tel:',
        '#',
      ]
      const hit = targets.find((t) => t.toLowerCase().startsWith(partial.toLowerCase()))
      if (!hit) return null
      const full = `${indent}${prefix}@${hit}`
      return full !== currentLine && full.startsWith(currentLine) ? full : null
    }
  }

  // typing ':name' → complete an element from the registry, or a component
  const openTyped = typed.match(/^:([a-zA-Z0-9-]*)$/)
  if (openTyped) {
    const partial = openTyped[1]!
    const element = Object.keys(ELEMENTS).find((n) => n !== 'body' && n.startsWith(partial))
    const component = componentNames.find((n) =>
      n.toLowerCase().startsWith(partial.toLowerCase()),
    )
    const full = element
      ? indent + tokenFor(element)
      : component
        ? `${indent}:${component}:`
        : null
    if (!full) return null
    return full !== currentLine && full.startsWith(currentLine) ? full : null
  }

  // typing 'name' → complete the close tag of the nearest open element
  const closeTyped = typed.match(/^([a-z0-9-]+):?$/)
  if (closeTyped) {
    const { stack } = analyze(before)
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.type !== 'body' && stack[i]!.type.startsWith(closeTyped[1]!)) {
        const full = `${indent}${stack[i]!.type}:`
        return full !== currentLine && full.startsWith(currentLine) ? full : null
      }
    }
  }

  return null
}