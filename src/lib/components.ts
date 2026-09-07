import type { ComponentDef, ElementNode } from '@/types/editor'

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
  const arg = node.arg ? `[${node.arg}]` : ''
  // node.link stores '@item' for the current-entry sentinel, verbatim otherwise
  const link = node.link ? `@${node.link === '@item' ? 'item' : node.link}` : ''
  if (!node.children.length) return [`${indent}:${node.type}${arg}:${link}`]
  return [
    `${indent}:${node.type}${arg}${link}`,
    ...node.children.flatMap((child) => serializeNode(child, `${indent}\t`)),
    `${indent}${node.type}:`,
  ]
}

/** a node's SHALLOW code identity — the DSL its own line encodes: type, the
 * [arg] binding, the @link. Deliberately NOT recursive: matching is done one
 * level at a time (like the page reconciler matching by line), so a container
 * keeps its identity even when its children change, while its children realign
 * among themselves. Classes/content/interactions are excluded — they are the
 * off-code state we're carrying across the edit. Two `:link:@/a` and
 * `:link:@/b` get distinct signatures; two bare `:link:` are genuinely
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
      hadInteractions: m.interactions?.length ?? 0,
    })
  })
  return result
}

/**
 * Expands freshly typed component references into their full editable
 * block: a `:Card:` leaf, or an empty `:Card` / `Card:` pair, becomes
 * `:Card` + the master's structure + `Card:`.
 */
export function expandComponentInstances(code: string, components: ComponentDef[]): string {
  if (!components.length) return code
  const lines = code.split('\n')
  const out: string[] = []
  /** component blocks currently open — a component never expands inside itself */
  const stack: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    const indent = line.match(/^\t*/)![0]

    const close = trimmed.match(/^([A-Z][a-zA-Z0-9-]*):$/)
    if (close && stack[stack.length - 1] === close[1]) {
      stack.pop()
      out.push(line)
      continue
    }

    const leaf = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*):$/)
    const leafDef = leaf ? components.find((c) => c.name === leaf[1]) : null
    if (leafDef && !stack.includes(leafDef.name)) {
      out.push(`${indent}:${leafDef.name}`)
      out.push(...leafDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)))
      out.push(`${indent}${leafDef.name}:`)
      continue
    }

    const open = trimmed.match(/^:([A-Z][a-zA-Z0-9-]*)$/)
    const openDef = open ? components.find((c) => c.name === open[1]) : null
    if (openDef && !stack.includes(openDef.name) && lines[i + 1]?.trim() === `${openDef.name}:`) {
      out.push(line)
      out.push(...openDef.root.children.flatMap((c) => serializeNode(c, `${indent}\t`)))
      out.push(lines[i + 1]!)
      i++
      continue
    }

    if (open) stack.push(open[1]!)
    out.push(line)
  }

  return out.join('\n')
}
