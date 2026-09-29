import type { ComponentDef, ElementNode } from '@/types/editor'
import { isLeafElement } from './elements'
import { refOf, withoutRef } from './syntax'
import { walkNodes } from './tree'

/**
 * Deep-clone a subtree into the master id space: fresh ids, line info dropped,
 * and interaction/animation binding `targetId`s that point INSIDE the subtree
 * rewritten onto the new ids — without the rewrite every internal binding
 * (a modal's close button, an accordion trigger) keeps aiming at the PAGE
 * node ids and goes dead the moment the block becomes a component.
 * Returns the clone plus the old→new id map (the key set doubles as "which
 * page ids are inside the extracted subtree" for outside-target detection).
 */
export function cloneForMaster(source: ElementNode): {
  cloned: ElementNode
  idMap: Map<string, string>
} {
  const cloned = JSON.parse(JSON.stringify(source)) as ElementNode
  const idMap = new Map<string, string>()
  walkNodes([cloned], (n) => {
    const next = crypto.randomUUID()
    idMap.set(n.id, next)
    n.id = next
    delete n.line
    delete n.endLine
    // refs are PAGE-scope addresses; a master is cloned into every instance on
    // every page, so a ref surviving here would be duplicated site-wide
    delete n.ref
  })
  walkNodes([cloned], (n) => {
    for (const b of n.interactions ?? []) {
      if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId)!
    }
    for (const b of n.animations ?? []) {
      if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId)!
    }
  })
  return { cloned, idMap }
}

/**
 * After extraction the MASTER owns the subtree's presentation and content —
 * clear the source nodes' node-only state so the new instance INHERITS instead
 * of shadowing. A shadow looks identical at extraction time but bites later:
 * shared chrome gets translated once per page, and a master restructure can
 * re-seat the stale override onto the wrong node. `htmlId` stays (a per-page
 * anchor), `arg`/`link` stay (code-owned).
 */
export function stripExtractedInstanceState(source: ElementNode): void {
  walkNodes([source], (n) => {
    delete n.classes
    delete n.interactions
    delete n.animations
    delete n.attributes
    delete n.src
    delete n.svg
    delete n.background
    delete n.locales
    delete n.content
  })
}

/** component types are Capitalized in the syntax; built-ins stay lowercase */
export function isComponentType(type: string): boolean {
  return /^[A-Z]/.test(type)
}

/** turns raw user input into a valid, unique component name ('my card' → 'MyCard') */
export function normalizeComponentName(raw: string, taken: string[]): string {
  const cleaned = raw
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  const base = /^[A-Za-z]/.test(cleaned) ? cleaned : `C${cleaned}`
  const name = base.charAt(0).toUpperCase() + base.slice(1) || 'Component'
  if (!taken.includes(name)) return name
  let n = 2
  while (taken.includes(`${name}${n}`)) n++
  return `${name}${n}`
}

/** serializes a master node back into syntax lines at the given indent —
 * including its code-owned decorations: the [arg] binding and the @link
 * suffix (dropping them would strip bindings/links from every instance on
 * each structure rewrite) */
export function serializeNode(node: ElementNode, indent: string): string[] {
  // `ref` is deliberately NOT emitted. This serializes MASTER nodes, and a
  // master's structure is cloned into every instance on every page — emitting a
  // ref would duplicate it site-wide, which is exactly what makes refs inside a
  // component block a diagnostic. cloneForMaster strips it on the way in; this
  // is the matching guard on the way out.
  const arg = node.arg ? `[${node.arg}]` : ''
  // node.link stores '@item' for the current-entry sentinel, verbatim otherwise
  const link = node.link ? `@${node.link === '@item' ? 'item' : node.link}` : ''
  // form follows the REGISTRY, not the child count: a childless container
  // (an empty :textarea, an empty :div) keeps its block spelling. Collapsing
  // it to the leaf form desynced expansion alignment from the author's own
  // block-form line, and the instance node — with its htmlId — was orphaned
  // on the next re-expansion.
  if (isLeafElement(node.type)) return [`${indent}:${node.type}${arg}:${link}`]
  return [
    `${indent}:${node.type}${arg}${link}`,
    ...node.children.flatMap((child) => serializeNode(child, `${indent}\t`)),
    `${indent}${node.type}:`,
  ]
}

/**
 * Extraction helper: refs on the lines about to be wrapped in ':Name … Name:'.
 *
 * The block ROOT's ref is hoisted onto the wrapper — the instance root is a
 * real page node, so it keeps its address — and every ref BELOW it is dropped,
 * because those lines become the master's structure and get rewritten into
 * every instance. Shared by the editor's createComponent and MCP's
 * makeComponentFrom so the two can't drift.
 */
export function hoistBlockRef(innerLines: string[]): { ref?: string; lines: string[] } {
  return { ref: refOf(innerLines[0] ?? ''), lines: innerLines.map(withoutRef) }
}

/** a node's SHALLOW code identity — the DSL its own line encodes: type, the
 * [arg] binding, the @link. Deliberately NOT recursive: matching is done one
 * level at a time (like the page reconciler matching by line), so a container
 * keeps its identity even when its children change, while its children realign
 * among themselves. Classes/content/interactions are excluded — they are the
 * off-code state we're carrying across the edit. Two `:h2:@/a` and
 * `:h2:@/b` get distinct signatures; two bare `:h2:` are genuinely
 * indistinguishable (no algorithm can tell which identical sibling was
 * removed — same irreducible case the reconciler faces). */
function nodeSignature(node: ElementNode): string {
  return `${node.type}|${node.arg ?? ''}|${node.link ?? ''}`
}

/** longest-common-subsequence alignment of two signature lists → a map from
 * b-index to the a-index it matches. Same primitive the page reconciler uses,
 * so component adoption and page edits carry identity the same way — a removed
 * sibling no longer shifts the survivors onto the wrong master nodes. */
function lcsAlign(a: string[], b: string[]): Map<number, number> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
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

/** a line's token type: `:h1[x]:(+)` → ':h1', a closer `section:` → 'section:' */
function lineTypeSig(line: string): string {
  const t = line.trim()
  const open = t.match(/^:([A-Za-z][A-Za-z0-9-]*)/)
  if (open) return `:${open[1]}`
  const close = t.match(/^([A-Za-z][A-Za-z0-9-]*):$/)
  return close ? `${close[1]}:` : t
}

/**
 * Align an instance block's OLD inner lines to the freshly serialized NEW ones
 * (map: newIndex → oldIndex, both relative to the block). Exact-text LCS
 * first, then a weak pass matching leftover lines by token TYPE in order —
 * so a master edit that inserts a node or tweaks a link/arg keeps every other
 * instance node (and its per-instance content overrides) on the line it came
 * from, instead of the pure positional map re-seating everything after the
 * insertion one node off.
 */
export function alignInstanceLines(oldLines: string[], newLines: string[]): Map<number, number> {
  const matches = lcsAlign(oldLines.map((l) => l.trim()), newLines.map((l) => l.trim()))
  const used = new Set(matches.values())
  const freeOld = oldLines.map((_, i) => i).filter((i) => !used.has(i))
  const freeNew = newLines.map((_, i) => i).filter((i) => !matches.has(i))
  if (freeOld.length && freeNew.length) {
    const weak = lcsAlign(
      freeOld.map((i) => lineTypeSig(oldLines[i]!)),
      freeNew.map((i) => lineTypeSig(newLines[i]!)),
    )
    for (const [nj, oj] of weak) matches.set(freeNew[nj]!, freeOld[oj]!)
  }
  return matches
}

/** a master node that lost its place in an adoption — its id/classes/
 * interactions no longer render on any instance (surfaced by update_component
 * so the loss is never silent) */
export interface OrphanedNode {
  id: string
  type: string
  hadClasses: boolean
  hadInteractions: number
}

export interface AdoptResult {
  adopted: number
  created: number
  orphaned: OrphanedNode[]
}

/**
 * Re-derive a component master's children from an edited instance's subtree,
 * CARRYING node identity (id/classes/content/interactions) wherever the code
 * structure still lines up, minting fresh nodes only for genuinely new code.
 *
 * Matching is by code signature (type + arg + link + child structure) aligned
 * with an LCS — NOT greedy first-match-by-type, which silently re-seated a
 * survivor onto a removed sibling's master node (dragging its classes and
 * interaction bindings along) whenever a same-type child was deleted.
 *
 * `arg`/`link` are code-owned, so the edited block is authoritative for them.
 * Fills `result` with the adopt/create counts and any orphaned master nodes.
 */
export function adoptStructure(
  master: ElementNode,
  edited: ElementNode,
  selfName: string,
  result: AdoptResult = { adopted: 0, created: 0, orphaned: [] },
): AdoptResult {
  const masterChildren = master.children
  const editedChildren = edited.children.filter((child) => child.type !== selfName)
  const mSigs = masterChildren.map(nodeSignature)
  const eSigs = editedChildren.map(nodeSignature)
  const matches = lcsAlign(mSigs, eSigs) // editedIndex → masterIndex
  // Second chance on a WEAKER signature (type + arg, no link): a link-suffix
  // edit is the most common component change (`@#rooms` → `@/#rooms`), and the
  // strong signature would orphan every touched node — dropping its classes,
  // content and bindings for a change that never meant to replace it. Only
  // children the strong pass left unmatched participate, aligned in order, so
  // links still disambiguate siblings whenever they CAN.
  const weakSignature = (n: ElementNode) => `${n.type}|${n.arg ?? ''}`
  const freeMaster = masterChildren.map((_, i) => i).filter((i) => ![...matches.values()].includes(i))
  const freeEdited = editedChildren.map((_, i) => i).filter((i) => !matches.has(i))
  if (freeMaster.length && freeEdited.length) {
    const weak = lcsAlign(
      freeMaster.map((i) => weakSignature(masterChildren[i]!)),
      freeEdited.map((i) => weakSignature(editedChildren[i]!)),
    )
    for (const [ej, mj] of weak) matches.set(freeEdited[ej]!, freeMaster[mj]!)
  }
  const usedMaster = new Set(matches.values())

  master.children = editedChildren.map((child, ei) => {
    const mi = matches.get(ei)
    let node: ElementNode
    if (mi !== undefined) {
      node = masterChildren[mi]!
      result.adopted++
    } else {
      node = {
        id: crypto.randomUUID(),
        type: child.type,
        content: child.content,
        locales: child.locales ? JSON.parse(JSON.stringify(child.locales)) : undefined,
        attributes: child.attributes ? JSON.parse(JSON.stringify(child.attributes)) : undefined,
        children: [],
      }
      result.created++
    }
    // arg + link are CODE-owned — the edited block is authoritative
    if (child.arg) node.arg = child.arg
    else delete node.arg
    if (child.link) node.link = child.link
    else delete node.link
    adoptStructure(node, child, selfName, result)
    return node
  })

  // master children that no LCS match claimed lose their identity for good
  masterChildren.forEach((m, mi) => {
    if (usedMaster.has(mi)) return
    result.orphaned.push({
      id: m.id,
      type: m.type,
      hadClasses: !!m.classes?.trim(),
      hadInteractions: (m.interactions?.length ?? 0) + (m.animations?.length ?? 0),
    })
  })
  return result
}

/**
 * Expands freshly typed component references into their full editable
 * block: a `:Card:` leaf, or an empty `:Card` / `Card:` pair, becomes
 * `:Card` + the master's structure + `Card:`.
 */
export function expandComponentInstances(
  code: string,
  components: ComponentDef[],
  /** filled with the output line index of each input line — lets a caller
   * report how much instance expansion shifted the author's line numbers */
  lineMap?: number[],
): string {
  if (!components.length) {
    if (lineMap) code.split('\n').forEach((_, i) => lineMap.push(i))
    return code
  }
  const lines = code.split('\n')
  const out: string[] = []
  const mark = () => lineMap?.push(out.length)
  /** component blocks currently open — a component never expands inside itself */
  const stack: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    const indent = line.match(/^\t*/)![0]

    const close = trimmed.match(/^([A-Z][a-zA-Z0-9-]*):$/)
    if (close && stack[stack.length - 1] === close[1]) {
      stack.pop()
      mark()
      out.push(line)
      continue
    }

    const leaf = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*):$/)
    const leafDef = leaf ? components.find((c) => c.name === leaf[1]) : null
    if (leafDef && !stack.includes(leafDef.name)) {
      mark()
      out.push(`${indent}:${leafDef.name}`)
      out.push(...leafDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)))
      out.push(`${indent}${leafDef.name}:`)
      continue
    }

    const open = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*)$/)
    const openDef = open ? components.find((c) => c.name === open[1]) : null
    if (openDef && !stack.includes(openDef.name) && lines[i + 1]?.trim() === `${openDef.name}:`) {
      mark()
      out.push(line)
      out.push(...openDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)))
      mark()
      out.push(lines[i + 1]!)
      i++
      continue
    }

    if (open) stack.push(open[1]!)
    mark()
    out.push(line)
  }

  return out.join('\n')
}
