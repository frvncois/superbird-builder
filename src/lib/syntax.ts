import type { ElementNode } from '@/types/editor'
import { ELEMENTS, createNode, isKnownElement, isLeafElement } from './elements'
import { isComponentType } from './components'
import { walkNodes } from './tree'

// tokens may carry an argument: :h1[title]:, :collection-list[post], :body[post]
// and an optional link suffix: :link:@item, :div@/about, :button:@https://x
// args allow a dot for one-hop reference bindings: :h1[author.name]:
// a '(+)' after the arg slot is the styled marker — display-only, derived from
// node.classes; the group is non-capturing (and tolerates the mid-typing forms
// '(', '(+', '()') so it never reaches node.arg and never splits the token
// the arg's closing ']' is optional so an unclosed bracket mid-typing
// (':h1[:', ':h1[po:') keeps matching — the node stays in the tree and its
// identity/classes/content survive reconcile while the arg is being edited
// a '{+}' after the style marker is the interactions marker — same rules as
// '(+)' but derived from node.interactions; mid-typing '{', '{+', '{}' tolerated
const LEAF = /^:([a-zA-Z][a-zA-Z0-9-]*)(?:\[([a-z0-9.+-]*)\]?)?(?:\(\+?\)?)?(?:\{\+?\}?)?:(?:@(\S+))?$/ // :h1: or :Card: (+@link)
export const OPEN = /^:([a-zA-Z][a-zA-Z0-9-]*)(?:\[([a-z0-9.+-]*)\]?)?(?:\(\+?\)?)?(?:\{\+?\}?)?(?:@(\S+))?$/ // :section or :Card (+@link)
export const CLOSE = /^([a-zA-Z][a-zA-Z0-9-]*):$/ // section: or Card:

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
      if (text[j] === '[') {
        // optional argument: [title] — consumed even while still
        // unclosed, so mid-typing never splits the token across lines
        let k = j + 1
        while (k < text.length && /[a-z0-9.+-]/.test(text[k]!)) k++
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
const TOKEN_HEAD = /^(\s*:[a-zA-Z][a-zA-Z0-9-]*(?:\[[a-z0-9.+-]*\])?)(\(\+?\)?)?/

/** the :body wrapper's open line — tolerates an arg and (possibly mid-typing)
 * style/interaction markers: ':body', ':body[post]', ':body(', ':body[post](+){+}'.
 * Every scaffold matcher must use this so a '(' typed on the body line can't
 * make the wrapper look damaged (which would respawn a fresh :body). */
export const isBodyOpenLine = (trimmed: string) => /^:body(?:$|[[({])/.test(trimmed)

/** the marker currently on the line's token: '(+)', or a mid-typing '(', '(+', '()' */
export function styleMarkerOf(line: string): string | undefined {
  return line.match(TOKEN_HEAD)?.[2] || undefined
}

/** the line's token has an unclosed '[' arg — an arg edit in progress */
export function hasOpenArgBracket(line: string): boolean {
  return /^\s*:[a-zA-Z][a-zA-Z0-9-]*\[[^\]]*$/.test(line)
}

/** finalizes an unclosed '[' arg: non-empty → close it (':h1[po' → ':h1[po]'),
 * empty → remove it (':h1[:' → ':h1:'). No-ops on closed args and non-token
 * lines. The lookahead excludes arg chars too, so backtracking can never
 * split a CLOSED arg like '[title]' and re-close it mid-word. */
export function closeArgBracket(line: string): string {
  return line.replace(
    /^(\s*:[a-zA-Z][a-zA-Z0-9-]*)\[([a-z0-9.+-]*)(?![\]a-z0-9.+-])/,
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
const INT_HEAD = /^(\s*:[a-zA-Z][a-zA-Z0-9-]*(?:\[[a-z0-9.+-]*\])?(?:\(\+?\)?)?)(\{\+?\}?)?/

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
const DATA_HEAD = /^(\s*:[a-zA-Z][a-zA-Z0-9-]*)(\[[a-z0-9.+-]*\]?)?/

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
      if (open && opensDepth(open[1]!)) depth += 1
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
  adopt?: (line: number, type: string) => ElementNode | null,
): ElementNode[] {
  const root: ElementNode[] = []
  const stack: ElementNode[] = []

  const append = (node: ElementNode) => {
    ;(stack[stack.length - 1]?.children ?? root).push(node)
  }

  // reuses the existing node for this source position when the caller
  // can identify one — its children are rebuilt from the code below
  const nodeFor = (line: number, type: string): ElementNode => {
    const existing = adopt?.(line, type)
    if (!existing) return createNode(type)
    existing.children = []
    return existing
  }

  const lines = code.split('\n')
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    for (const token of lexLine(lines[lineIndex]!.trim())) {
      const leaf = token.match(LEAF)
      if (leaf) {
        // known elements and component instances (:Card:) become nodes
        if (isKnownElement(leaf[1]!) || isComponentType(leaf[1]!)) {
          const node = nodeFor(lineIndex, leaf[1]!)
          node.line = node.endLine = lineIndex
          node.arg = leaf[2] && leaf[2] !== '+' ? leaf[2] : undefined
          node.link = linkFromToken(leaf[3])
          append(node)
        }
        continue
      }
      const open = token.match(OPEN)
      if (open) {
        // built-ins and component blocks (:Card … Card:) open nodes
        if (isKnownElement(open[1]!) || isComponentType(open[1]!)) {
          const node = nodeFor(lineIndex, open[1]!)
          node.line = node.endLine = lineIndex
          node.arg = open[2] && open[2] !== '+' ? open[2] : undefined
          node.link = linkFromToken(open[3])
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
}

export function reconcile(
  oldCode: string,
  newCode: string,
  previous: ElementNode[],
  map: Map<number, number> = lineMap(oldCode, newCode),
  stats?: ReconcileStats,
): ElementNode[] {
  // index the existing nodes by the line they live on, in token order
  const byOldLine = new Map<number, ElementNode[]>()
  walkNodes(previous, (node) => {
    if (node.line === undefined) return
    const list = byOldLine.get(node.line) ?? []
    list.push(node)
    byOldLine.set(node.line, list)
  })

  // old lines already accounted for by the diff — the same-line
  // fallback below must never steal their nodes
  const mappedOldLines = new Set(map.values())

  return parseSyntax(newCode, (line, type) => {
    // in-place edits (chars typed on an element's own line) defeat the
    // text diff, so fall back to the same physical line — but only when
    // that old line wasn't matched elsewhere
    const oldLine = map.get(line) ?? (mappedOldLines.has(line) ? undefined : line)
    const candidates = oldLine === undefined ? undefined : byOldLine.get(oldLine)
    const at = candidates?.findIndex((n) => n.type === type) ?? -1
    if (at === -1) {
      if (stats) stats.created++
      return null
    }
    if (stats) stats.adopted++
    return candidates!.splice(at, 1)[0]!
  })
}

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
  /** multi-reference field names — also valid as :collection-list args */
  listFieldNames: string[] = [],
): Diagnostic[] {
  const lines = code.split('\n')
  const trimmed = lines.map((l) => l.trim())
  const start = trimmed.findIndex(isBodyOpenLine)
  const end = trimmed.lastIndexOf('body:')
  if (start === -1 || end <= start) return []

  const stack: { type: string; line: number; indent: number }[] = []
  const diags: Diagnostic[] = []

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
      const name = leaf?.[1] ?? open?.[1]

      // collection embeds — the arg must name a real collection (a list may
      // also name a multi-reference field it iterates)
      if (name === 'collection-list' || name === 'collection-item') {
        const arg = leaf?.[2] ?? open?.[2]
        const known =
          !!arg &&
          (collectionNames.includes(arg) ||
            (name === 'collection-list' && listFieldNames.includes(arg)))
        if (!known) {
          diags.push({ line: i, message: `Unknown collection ':${name}[${arg ?? ''}]'` })
        } else if (open) {
          stack.push({ type: name, line: i, indent })
        }
        continue
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
  stack: { type: string; indent: number }[]
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
        last = { kind: 'leaf', type: leaf[1]!, indent }
        continue
      }
      const open = token.match(OPEN)
      if (open) {
        if (isKnownElement(open[1]!) || isComponentType(open[1]!)) {
          stack.push({ type: open[1]!, indent })
        }
        last = { kind: 'open', type: open[1]!, indent }
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
  const def = ELEMENTS[type]
  return def && (def.defaultContent !== undefined || def.void) ? `:${type}:` : `:${type}`
}

/** Dedented source lines for a brand-new element of the given type */
export function elementBlockLines(type: string): string[] {
  const token = tokenFor(type)
  return token.endsWith(':') ? [token] : [token, `${type}:`]
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
        !!opts.onTemplate || analyze(before).stack.some((s) => s.type === 'collection-list')
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