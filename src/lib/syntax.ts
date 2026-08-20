import type { ElementNode } from '@/types/editor'
import { ELEMENTS, createNode, isKnownElement, isLeafElement } from './elements'
import { isComponentType } from './components'
import { walkNodes } from './tree'

// tokens may carry an argument: :h1(title):, :collection-list(post), :body(post)
const LEAF = /^:([a-zA-Z][a-zA-Z0-9-]*)(?:\(([a-z0-9-]*)\))?:$/ // :h1: or :Card:
export const OPEN = /^:([a-zA-Z][a-zA-Z0-9-]*)(?:\(([a-z0-9-]*)\))?$/ // :section or :Card
export const CLOSE = /^([a-zA-Z][a-zA-Z0-9-]*):$/ // section: or Card:

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
      if (text[j] === '(') {
        // optional argument: (title) — consumed even while still
        // unclosed, so mid-typing never splits the token across lines
        let k = j + 1
        while (k < text.length && /[a-z0-9-]/.test(text[k]!)) k++
        j = text[k] === ')' ? k + 1 : k
      }
      if (text[j] === ':' && !/[a-zA-Z]/.test(text[j + 1] ?? '')) j++ // leaf close
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
          node.arg = leaf[2] || undefined
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
          node.arg = open[2] || undefined
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
 * Maps each line of the new code to the line of the old code it came
 * from (longest common subsequence over exact lines). Lines that were
 * inserted or rewritten have no mapping.
 */
function lineMap(oldCode: string, newCode: string): Map<number, number> {
  const a = oldCode.split('\n')
  const b = newCode.split('\n')
  const n = a.length
  const m = b.length

  // dp[i][j] = LCS length of a[i:], b[j:]
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const map = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      map.set(j, i)
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
 * Re-derives the element tree from edited code WITHOUT recreating the
 * nodes: every element line that survived the edit keeps its node
 * object — id, classes, content, and any future per-node settings
 * travel with it. Only lines that were actually added produce new
 * nodes.
 *
 * `map` maps new line index → old line index. Callers that know the
 * exact line movement (e.g. drag reorder) pass it explicitly; code
 * edits leave it out and get a text-diff-derived map.
 */
export function reconcile(
  oldCode: string,
  newCode: string,
  previous: ElementNode[],
  map: Map<number, number> = lineMap(oldCode, newCode),
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
    if (oldLine === undefined) return null
    const candidates = byOldLine.get(oldLine)
    const at = candidates?.findIndex((n) => n.type === type) ?? -1
    return at === -1 ? null : candidates!.splice(at, 1)[0]!
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
): Diagnostic[] {
  const lines = code.split('\n')
  const trimmed = lines.map((l) => l.trim())
  const start = trimmed.findIndex((t) => t === ':body' || t.startsWith(':body('))
  const end = trimmed.lastIndexOf('body:')
  if (start === -1 || end <= start) return []

  const stack: { type: string; line: number }[] = []
  const diags: Diagnostic[] = []

  for (let i = start + 1; i < end; i++) {
    for (const token of lexLine(trimmed[i]!)) {
      const leaf = token.match(LEAF)
      const open = token.match(OPEN)
      const close = token.match(CLOSE)
      const name = leaf?.[1] ?? open?.[1]

      // collection embeds — the arg must name a real collection
      if (name === 'collection-list' || name === 'collection-item') {
        const arg = leaf?.[2] ?? open?.[2]
        if (!arg || !collectionNames.includes(arg)) {
          diags.push({ line: i, message: `Unknown collection ':${name}(${arg ?? ''})'` })
        } else if (open) {
          stack.push({ type: name, line: i })
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
          stack.push({ type: name, line: i })
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
          stack.push({ type: name, line: i })
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

  // just opened an element → suggest its first child
  if (last?.kind === 'open') {
    const childIndent = tabs(last.indent + 1)
    switch (last.type) {
      case 'body':
        return `${childIndent}:section`
      case 'section':
        return `${childIndent}:div`
      case 'list':
        return `${childIndent}:list-item:`
      case 'form':
        return `${childIndent}:input:`
      default:
        return `${childIndent}:h1:`
    }
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
): string | null {
  // blank line (or matching indent) → the contextual flow suggestion
  const flow = suggestNextLine(before)
  if (flow && flow.startsWith(currentLine) && flow !== currentLine) return flow

  const indent = currentLine.match(/^\t*/)![0]
  const typed = currentLine.trim()
  if (!typed) return null

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