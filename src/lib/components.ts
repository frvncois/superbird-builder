import type { ComponentDef, ElementNode } from '@/types/editor'
import { walkNodes } from './tree'

/**
 * Deep-clone a subtree into the master id space: fresh ids, and
 * interaction/animation binding `targetId`s that point INSIDE the subtree
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
  // slot content stays whole: it is the holder's own, and nothing above it
  // would give it back
  const strip = (n: ElementNode) => {
    if (!n.slot) n.children.forEach(strip)
    delete n.classes
    delete n.interactions
    delete n.animations
    delete n.attributes
    delete n.src
    delete n.svg
    // the master took the flag with the rest; left here it would shadow a
    // later change to the component's default
    delete n.hidden
    delete n.background
    delete n.locales
    delete n.content
  }
  strip(source)
}

/** component types are Capitalized; built-in elements stay lowercase */
export function isComponentType(type: string): boolean {
  return /^[A-Z]/.test(type)
}

// --- nesting: mirrors ---
//
// A component's master may hold an instance of another component. What it
// holds there is a MIRROR: the inner component's structure, node for node,
// carrying only what this host says about that instance — its text, its
// variant picks, its hidden parts. The classes, the interactions and the
// structure itself stay the inner component's, which is what makes restyling
// Button restyle the Button inside every Card.
//
// The one rule everything below keeps: a mirror is structurally identical to
// the master it mirrors — the positional pairing in shared/instances.js relies
// on it, and so does the push that realigns every instance.

/** a fresh mirror of a master subtree: its structure, none of its state —
 *  except under a slot, where the master's children are the DEFAULT content
 *  the holder starts from, copied whole (they are its own from then on) */
export function createMirror(master: ElementNode): ElementNode {
  const node: ElementNode = {
    id: crypto.randomUUID(),
    type: master.type,
    content: '',
    children: master.slot ? cloneSlotContent(master.children) : master.children.map(createMirror),
  }
  // `arg` is the master's by definition and is copied down (adoptCodeOwned).
  // `link` is NOT: it resolves along the chain (own → mirrors → master), so a
  // fresh mirror INHERITS the inner component's destination and the key means
  // "this placement differs" — which is also what adoptCodeOwned would delete
  // it back down to on the first push.
  if (master.arg) node.arg = master.arg
  if (master.slot) node.slot = true
  return node
}

/** a slot's default content, as a holder's own nodes: everything the master
 *  nodes carry, under fresh ids, with bindings between them re-aimed */
function cloneSlotContent(nodes: ElementNode[]): ElementNode[] {
  const cloned = JSON.parse(JSON.stringify(nodes)) as ElementNode[]
  const idMap = new Map<string, string>()
  walkNodes(cloned, (n) => {
    const next = crypto.randomUUID()
    idMap.set(n.id, next)
    n.id = next
    delete n.ref
  })
  walkNodes(cloned, (n) => {
    for (const b of [...(n.interactions ?? []), ...(n.animations ?? [])]) {
      if (b.targetId && idMap.has(b.targetId)) b.targetId = idMap.get(b.targetId)!
    }
  })
  return cloned
}

/**
 * `arg` is CODE-OWNED: inside an instance it belongs to the master, so it is
 * copied down rather than kept. A field binding is the component's by
 * definition — every instance of it reads the same field.
 *
 * `link` is NOT, any more. It is per-instance with a component default, like
 * `hidden`, `listQuery` and `slider`: every renderer already resolves it
 * own-first (`node.link ?? master.link`, in useRenderNode AND export.mjs), so
 * a per-instance destination rendered correctly everywhere and only the WRITE
 * path forbade it — half of it here, where the push copied the master's link
 * back down over anything an instance had set. The cost was that a Button
 * component could not be a link, which is the first thing anyone wants from
 * one, and the workaround was a second component.
 *
 * An instance link EQUAL to the master's is deleted rather than kept, so the
 * key means "this placement differs" and nothing else. That also migrates the
 * copies the old copy-down left behind: they are all equal by construction, so
 * one push normalizes a project to pure inheritance and a later change to the
 * master's link reaches every instance that did not override it.
 */
function adoptCodeOwned(node: ElementNode, master: ElementNode, box: { moved: boolean }): void {
  if ((node.arg ?? undefined) !== (master.arg ?? undefined)) {
    if (master.arg) node.arg = master.arg
    else delete node.arg
    box.moved = true
  }
  if (node.link !== undefined && node.link === master.link) {
    delete node.link
    box.moved = true
  }
  // so is the slot flag: the boundary has to be visible in every tree
  if (!!node.slot !== !!master.slot) {
    if (master.slot) node.slot = true
    else delete node.slot
    box.moved = true
  }
}

/**
 * Reshape one level of children to the master's, KEEPING the node object for
 * each child that survives — which is what carries everything the structure
 * does not: the id, the per-instance text, media, translations, hidden flag and
 * variant picks, and (on a page) the htmlId and comment anchors.
 *
 * Matched like `adoptStructure` matches — by code signature, LCS-aligned, then
 * by type for whatever that left over — so inserting an icon in Button does not
 * slide every Card's button text onto the wrong node.
 */
function alignLevel(node: ElementNode, master: ElementNode, box: { moved: boolean }): void {
  // under a slot the children are the holder's own: a push never touches them
  // (a node that has just become a slot keeps what it had, as its content)
  if (master.slot) return
  const old = node.children
  const matches = lcsAlign(old.map(nodeSignature), master.children.map(nodeSignature))
  const used = new Set(matches.values())
  const freeOld = old.map((_, i) => i).filter((i) => !used.has(i))
  const freeNew = master.children.map((_, i) => i).filter((i) => !matches.has(i))
  if (freeOld.length && freeNew.length) {
    const weak = lcsAlign(
      freeOld.map((i) => old[i]!.type),
      freeNew.map((i) => master.children[i]!.type),
    )
    for (const [nj, oj] of weak) matches.set(freeNew[nj]!, freeOld[oj]!)
  }

  const next = master.children.map((child, i) => {
    const at = matches.get(i)
    const kept = at !== undefined ? old[at]! : createMirror(child)
    if (at === undefined) box.moved = true
    adoptCodeOwned(kept, child, box)
    alignLevel(kept, child, box)
    return kept
  })
  // untouched when nothing moved: a subtree that was already in step must come
  // out byte-identical, or every push would read as an edit to the host
  if (next.length !== old.length || next.some((child, i) => child !== old[i])) {
    node.children = next
    box.moved = true
  }
}

/**
 * Bring an INSTANCE's subtree in step with the master it stands for, keeping
 * every per-instance value on the nodes that survive. The node's OWN line is
 * left alone — on a page that is a real page node, with its own ref, htmlId and
 * classes; what is below it is the component's.
 *
 * Returns whether anything moved, so a caller can tell a real change from a
 * push that found everything already current.
 */
export function alignStructure(instance: ElementNode, master: ElementNode): boolean {
  const box = { moved: false }
  alignLevel(instance, master, box)
  return box.moved
}

/**
 * The same, for a MIRROR a master holds: there the wrapper node is part of the
 * host's own tree, so its code-owned slots follow the inner master too (a
 * mirror that lacked them would not be structurally identical to it, which is
 * the invariant the positional pairing relies on).
 */
export function alignMirror(mirror: ElementNode, master: ElementNode): boolean {
  const box = { moved: false }
  adoptCodeOwned(mirror, master, box)
  alignLevel(mirror, master, box)
  return box.moved
}

/**
 * Bring every mirror a host holds back in step with the component it mirrors.
 * Returns whether anything changed.
 */
export function alignHostMirrors(host: ComponentDef, components: ComponentDef[]): boolean {
  let moved = false
  const visit = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      if (!isComponentType(node.type)) {
        visit(node.children)
        continue
      }
      const inner = components.find((c) => c.name === node.type)
      // the inner master already holds ITS mirrors in step (callers go inner
      // first), so aligning to it brings the deeper levels along
      if (inner && inner !== host && alignMirror(node, inner.root)) moved = true
    }
  }
  visit(host.root.children)
  return moved
}

/** every nested-instance wrapper a master holds directly (not the ones inside
 *  a mirror, which belong to the component being mirrored) */
export function nestedWrappers(def: ComponentDef, name?: string): ElementNode[] {
  const out: ElementNode[] = []
  const visit = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      if (!isComponentType(node.type)) visit(node.children)
      else if (!name || node.type === name) out.push(node)
    }
  }
  visit(def.root.children)
  return out
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

/** a node's SHALLOW identity: its type, its `[arg]` binding, its link.
 * Deliberately NOT recursive: matching is done one
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
