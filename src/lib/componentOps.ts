import type { ComponentDef, ElementNode, Page, Project } from '@/types/editor'
import { applyNodeMarkers, reconcile, refOf } from './syntax'
import {
  alignInstanceLines,
  cloneForMaster,
  expandComponentInstances,
  isComponentType,
  normalizeComponentName,
  serializeNode,
} from './components'
import { createNode, isLeafElement, seedChildFor } from './elements'
import { deepClone, findNode, findParent, walkNodes } from './tree'

/**
 * Whole-project operations on components — rename, duplicate, categorize,
 * detach, delete.
 *
 * These live here rather than in `useComponents` because every one of them
 * spans ALL pages, while the composable's `masterMap` / `detachComponent` are
 * bound to the active page; and rather than in `lib/components.ts` because
 * that module is re-exported into the committed MCP runtime bundle, which
 * would have to be rebuilt for changes that never concern an agent.
 *
 * All of it is pure: a `Project` in, mutations out, no Vue. That is what makes
 * it testable headlessly.
 */

/** matches a token line's opening ':Name', refusing a longer name that merely
 * starts with it (':CardHeader' is not an instance of 'Card') */
const openToken = (name: string) => new RegExp(`^(\\s*:)${name}(?![a-zA-Z0-9-])`)

const indentOf = (line: string) => line.match(/^\t*/)![0]

/**
 * The ONE writer of the two optional keys, so their JSON key order is the same
 * everywhere. `computeMerge` compares whole-object `JSON.stringify`, which is
 * key-order sensitive: a def built `{id,name,category,root}` and one built
 * `{id,name,root,category}` are equal in every way that matters and would
 * still read as a conflict. Deleting both and re-adding them puts them last,
 * always.
 */
export function setComponentMeta(
  def: ComponentDef,
  meta: { category?: string; source?: string },
): void {
  delete def.category
  delete def.source
  const category = meta.category?.trim()
  if (category) def.category = category
  if (meta.source) def.source = meta.source
}

export interface ComponentUsage {
  /** instances across every page */
  count: number
  pages: { id: string; name: string }[]
}

/** where a component is actually used — the number the delete confirm quotes */
export function componentUsage(project: Project, name: string): ComponentUsage {
  let count = 0
  const pages: { id: string; name: string }[] = []
  for (const page of project.pages) {
    let onPage = 0
    walkNodes(page.elements, (n) => {
      if (n.type === name) onPage++
    })
    if (!onPage) continue
    count += onPage
    pages.push({ id: page.id, name: page.name })
  }
  return { count, pages }
}

/**
 * Renames a component and every `:Name … Name:` token that refers to it.
 *
 * Returns the name actually used (normalized and de-duplicated), or null when
 * the id doesn't resolve.
 */
export function renameComponent(project: Project, id: string, rawName: string): string | null {
  const def = project.components.find((c) => c.id === id)
  if (!def) return null
  // the component itself is excluded from `taken`, or renaming 'Card' to
  // 'Card' (or just recasing it) would collide with itself and yield 'Card2'
  const taken = project.components.filter((c) => c.id !== id).map((c) => c.name)
  const name = normalizeComponentName(rawName, taken)
  if (name === def.name) return name

  const old = def.name
  // the def FIRST: an instance is paired to its master BY NAME, in the editor
  // (masterMap) and in the exporter alike, and the sync watcher's structure
  // signature reads the root type. Leave either lagging and every instance
  // reads as divergent — adoptStructure would then reshape the master from a
  // page block that no longer matches it.
  def.name = name
  def.root.type = name

  const open = openToken(old)
  for (const page of project.pages) {
    const lines = page.code.split('\n')
    let changed = false
    walkNodes(page.elements, (node) => {
      if (node.type !== old) return
      node.type = name
      const at = node.line
      if (at === undefined) return
      const line = lines[at]
      if (line !== undefined && open.test(line)) {
        lines[at] = line.replace(open, `$1${name}`)
        changed = true
      }
      const end = node.endLine
      if (end !== undefined && end !== at && lines[end]?.trim() === `${old}:`) {
        lines[end] = `${indentOf(lines[end]!)}${name}:`
        changed = true
      }
    })
    // patched in place — the line COUNT never changes, so there is no reparse
    // and no reconcile, and every node id survives. That matters: comment
    // anchors and interaction targetIds address page nodes by id.
    if (changed) page.code = lines.join('\n')
  }
  return name
}

/** An independent copy under a new name. Creates no instances. */
export function duplicateComponent(project: Project, id: string): ComponentDef | null {
  const def = project.components.find((c) => c.id === id)
  if (!def) return null
  const name = normalizeComponentName(
    `${def.name}Copy`,
    project.components.map((c) => c.name),
  )
  // cloneForMaster rather than a bare deep clone: it mints fresh master ids AND
  // rewrites the bindings that pointed inside the tree onto them. A plain copy
  // would leave the duplicate's own interactions aiming at the ORIGINAL's
  // nodes, which resolve globally — so firing one would animate the other.
  const { cloned } = cloneForMaster(def.root)
  cloned.type = name
  const copy: ComponentDef = { id: crypto.randomUUID(), name, root: cloned }
  // the category carries over; `source` deliberately does not — a copy made to
  // be edited is no longer the library entry it came from
  setComponentMeta(copy, { category: def.category })
  project.components.push(copy)
  return copy
}

export function setComponentCategory(project: Project, id: string, category: string): boolean {
  const def = project.components.find((c) => c.id === id)
  if (!def) return false
  setComponentMeta(def, { category, source: def.source })
  return true
}

// --- detaching ---------------------------------------------------------

interface Pair {
  node: ElementNode
  master: ElementNode
}

/**
 * Pairs an instance's nodes with their masters by structural position — the
 * same index+type walk `useComponents`' masterMap does, but over any page
 * rather than only the active one.
 */
function pairWithMaster(instance: ElementNode, root: ElementNode) {
  const pairs: Pair[] = []
  const masterToInstance = new Map<string, string>()
  const pair = (inst: ElementNode, master: ElementNode) => {
    if (inst.type !== master.type) return
    pairs.push({ node: inst, master })
    masterToInstance.set(master.id, inst.id)
    const length = Math.min(inst.children.length, master.children.length)
    for (let i = 0; i < length; i++) pair(inst.children[i]!, master.children[i]!)
  }
  pair(instance, root)
  return { pairs, masterToInstance }
}

/** Copies the master's shared state onto the page nodes that were inheriting it. */
function bakeMasterState(pairs: Pair[], masterToInstance: Map<string, string>): void {
  const retarget = (targetId: string | null) =>
    targetId ? (masterToInstance.get(targetId) ?? targetId) : null
  for (const { node, master } of pairs) {
    if (master.classes) node.classes = master.classes
    if (master.attributes) node.attributes = deepClone(master.attributes)
    // fresh binding ids: the master's bindings keep running on the instances
    // that are still attached, and two bindings sharing an id would key the
    // same breakpoint/session state
    if (master.interactions?.length) {
      node.interactions = master.interactions.map((b) => ({
        ...deepClone(b),
        id: crypto.randomUUID(),
        targetId: retarget(b.targetId),
      }))
    }
    if (master.animations?.length) {
      node.animations = master.animations.map((b) => ({
        ...deepClone(b),
        id: crypto.randomUUID(),
        targetId: retarget(b.targetId),
      }))
    }
    // Content, media and translations follow the renderers' own-then-master
    // precedence, so they are inherited exactly where the instance has none of
    // its own. Skipping them is what used to make detaching lose a component's
    // text and images — the nodes were stripped at extraction and never got
    // them back.
    if (!node.content && master.content) node.content = master.content
    if (!node.src && master.src) node.src = master.src
    if (!node.svg && master.svg) node.svg = master.svg
    if (!node.background && master.background) node.background = master.background
    if (!node.locales && master.locales) node.locales = deepClone(master.locales)
  }
}

/**
 * The exporter's own test (`server/export.mjs`, renderNode): a `:Name` wrapper
 * with nothing of its own emits NO element at all — its children render
 * inline. Such a wrapper has to be UNWRAPPED on detach, not retyped: a `:div`
 * in its place would add a box the published page never had, and with it
 * whatever `space-y-*` / `divide-*` / `first:` rules the real parent applies
 * to its children.
 */
function isBareWrapper(root: ElementNode): boolean {
  return !root.classes?.trim() && !root.background && !root.interactions?.length
}

/** `:Card:` leaf instances can sit unexpanded in stored code (nothing expands
 * them until someone types in that page). Detaching one means materializing
 * the master's structure first, so there are nodes to bake onto. Only THIS
 * component's leaves are touched. */
function expandLeafInstances(page: Page, def: ComponentDef): void {
  const lineMap: number[] = []
  const next = expandComponentInstances(page.code, [def], lineMap)
  if (next === page.code) return
  const map = new Map<number, number>()
  lineMap.forEach((out, input) => map.set(out, input))
  const before = page.code
  page.code = next
  page.elements = reconcile(before, next, page.elements, map)
}

const withRef = (line: string, ref: string) =>
  line.replace(/^(\s*:[a-zA-Z][a-zA-Z0-9-]*)/, `$1#${ref}`)

/** Detaches one already-expanded instance block. */
function detachOne(page: Page, def: ComponentDef, instanceId: string): boolean {
  const instance = findNode(page.elements, instanceId)
  if (!instance || instance.type !== def.name || instance.line === undefined) return false

  const { pairs, masterToInstance } = pairWithMaster(instance, def.root)
  bakeMasterState(pairs, masterToInstance)

  const lines = page.code.split('\n')
  const start = instance.line
  const end = instance.endLine ?? instance.line

  if (!isBareWrapper(def.root)) {
    // a styled/interactive wrapper is a real box on the published page, and it
    // just took the master's classes — it stays, as a plain div. The line count
    // is unchanged, so this needs no reconcile.
    lines[start] = lines[start]!.replace(openToken(def.name), '$1div')
    if (end > start) lines[end] = `${indentOf(lines[end]!)}div:`
    instance.type = 'div'
    page.code = lines.join('\n')
    return true
  }

  // bare: drop the two wrapper lines and dedent what they held
  const inner = end > start ? lines.slice(start + 1, end) : []
  const dropped = end > start ? 2 : 1
  const rest = [
    ...lines.slice(0, start),
    ...inner.map((l) => l.replace(/^\t/, '')),
    ...lines.slice(end + 1),
  ]
  // the wrapper's addresses move onto what it wrapped, so a ref or an anchor
  // id aimed at this block still resolves to something
  if (inner.length) {
    const ref = refOf(lines[start]!)
    if (ref && !refOf(rest[start]!)) rest[start] = withRef(rest[start]!, ref)
    const firstChild = instance.children[0]
    if (firstChild && instance.htmlId && !firstChild.htmlId) firstChild.htmlId = instance.htmlId
  }

  const map = new Map<number, number>()
  for (let i = 0; i < rest.length; i++) {
    if (i < start) map.set(i, i)
    else if (i < start + inner.length) map.set(i, i + 1)
    else map.set(i, i + dropped)
  }
  const before = page.code
  page.code = rest.join('\n')
  page.elements = reconcile(before, page.code, page.elements, map)
  return true
}

/**
 * Turns every instance of a component, on every page, back into plain
 * elements that look exactly the same. Returns how many were detached.
 */
export function detachComponentInstances(project: Project, def: ComponentDef): number {
  let detached = 0
  for (const page of project.pages) {
    expandLeafInstances(page, def)
    const instances: ElementNode[] = []
    walkNodes(page.elements, (n) => {
      if (n.type === def.name && n.line !== undefined) instances.push(n)
    })
    if (!instances.length) continue
    // bottom-up: unwrapping a block shifts every line after it, so working
    // upwards keeps the ids we haven't reached yet on the lines we read
    const ordered = [...instances].sort((a, b) => b.line! - a.line!).map((n) => n.id)
    for (const id of ordered) if (detachOne(page, def, id)) detached++
    // the baked classes and bindings need their '(+)' / '{+}' markers, and the
    // editor's own truth-sync only ever runs on the page someone has open
    const marked = applyNodeMarkers(page.code, page.elements)
    if (marked !== page.code) page.code = marked
  }
  return detached
}

/** Detaches a single instance — the canvas context menu's "Detach". */
export function detachInstance(project: Project, page: Page, instanceId: string): boolean {
  const node = findNode(page.elements, instanceId)
  const def = node ? project.components.find((c) => c.name === node.type) : null
  if (!def) return false
  // the instance keeps its id through expansion (reconcile adopts it), though
  // its line may have moved
  expandLeafInstances(page, def)
  if (!detachOne(page, def, instanceId)) return false
  const marked = applyNodeMarkers(page.code, page.elements)
  if (marked !== page.code) page.code = marked
  return true
}

// --- master structure --------------------------------------------------
//
// A component master is a plain ElementNode tree: no code, no line numbers.
// So these mutate it directly and then PUSH the new shape out to every
// instance, which is the reverse of `syncStructure`'s instance-first flow.
//
// The push must be synchronous and complete: `syncStructure` watches page code
// and adopts a divergent instance back into the master, so a half-pushed edit
// would be reverted by the first instance still carrying the old shape.

export type DropPosition = 'before' | 'after' | 'inside'

/** Can this master node hold children? Registry-driven, NOT child-count based:
 *  a childless `:div` is still a container, while `serializeNode` emits a leaf
 *  in leaf form and would silently drop anything put inside it. */
export function masterAcceptsChildren(node: ElementNode): boolean {
  return !isLeafElement(node.type)
}

/** the wrapper node is the component itself — it is renamed, never restructured */
const isRoot = (def: ComponentDef, node: ElementNode) => node.id === def.root.id

function masterParentOf(def: ComponentDef, id: string): ElementNode | null {
  return findParent([def.root], id)
}

/** where an insert/move lands: the parent list plus the index within it */
function resolveSlot(
  def: ComponentDef,
  targetId: string | null,
  position: DropPosition,
): { parent: ElementNode; index: number } | null {
  if (!targetId) return { parent: def.root, index: def.root.children.length }
  const target = findNode([def.root], targetId)
  if (!target) return null
  // the root only ever takes children; so does any before/after on it, since
  // it has no siblings
  if (isRoot(def, target) || position === 'inside') {
    if (!masterAcceptsChildren(target)) {
      // a leaf can't hold it — fall back to "after the leaf", as the page's
      // insertElementBlock coerces
      const parent = masterParentOf(def, target.id)
      if (!parent) return null
      return { parent, index: parent.children.indexOf(target) + 1 }
    }
    return { parent: target, index: target.children.length }
  }
  const parent = masterParentOf(def, target.id)
  if (!parent) return null
  const at = parent.children.indexOf(target)
  return { parent, index: position === 'before' ? at : at + 1 }
}

/** ids whose subtree contains `id` — a node may never be moved into itself */
function isWithin(root: ElementNode, ancestorId: string, id: string): boolean {
  const ancestor = findNode([root], ancestorId)
  return !!ancestor && ancestor.id !== id && !!findNode(ancestor.children, id)
}

export function canDropInMaster(
  def: ComponentDef,
  ids: string[],
  targetId: string,
  position: DropPosition,
): boolean {
  const target = findNode([def.root], targetId)
  if (!target) return false
  if (position === 'inside' && !masterAcceptsChildren(target)) return false
  if (isRoot(def, target) && position !== 'inside') return false
  for (const id of ids) {
    if (id === targetId) return false
    if (isRoot(def, findNode([def.root], id) ?? target)) return false
    if (isWithin(def.root, id, targetId)) return false // into its own subtree
  }
  return true
}

/** Inserts a fresh element. Component payloads are refused — components
 *  cannot nest — so this only ever takes a built-in element type. */
export function insertInMaster(
  def: ComponentDef,
  type: string,
  targetId: string | null,
  position: DropPosition,
): ElementNode | null {
  if (isComponentType(type)) return null
  const slot = resolveSlot(def, targetId, position)
  if (!slot) return null
  const node = createNode(type)
  // a seeded container (button, link) is born holding its words, exactly as
  // the page backend's `elementBlockLines` + `applySeedContent` pair does
  const seed = seedChildFor(type)
  if (seed) node.children.push(seed)
  slot.parent.children.splice(slot.index, 0, node)
  return node
}

/** Detaches nodes from the tree and returns them, deepest-first so indices
 *  stay valid while splicing. */
function detachNodes(def: ComponentDef, ids: string[]): ElementNode[] {
  const taken: ElementNode[] = []
  for (const id of ids) {
    const node = findNode([def.root], id)
    if (!node || isRoot(def, node)) continue
    const parent = masterParentOf(def, id)
    if (!parent) continue
    const at = parent.children.indexOf(node)
    if (at === -1) continue
    parent.children.splice(at, 1)
    taken.push(node)
  }
  return taken
}

/** Interaction/animation bindings anywhere in the master that pointed into a
 *  removed subtree would dangle, so drop them. */
function clearBindingsTo(def: ComponentDef, removed: ElementNode[]) {
  const gone = new Set<string>()
  for (const node of removed) walkNodes([node], (n) => gone.add(n.id))
  if (!gone.size) return
  walkNodes([def.root], (n) => {
    if (n.interactions?.length) {
      n.interactions = n.interactions.filter((b) => !b.targetId || !gone.has(b.targetId))
      if (!n.interactions.length) delete n.interactions
    }
    if (n.animations?.length) {
      n.animations = n.animations.filter((b) => !b.targetId || !gone.has(b.targetId))
      if (!n.animations.length) delete n.animations
    }
  })
}

export function removeFromMaster(def: ComponentDef, ids: string[]): boolean {
  const removed = detachNodes(def, ids)
  if (!removed.length) return false
  clearBindingsTo(def, removed)
  return true
}

export function moveInMaster(
  def: ComponentDef,
  ids: string[],
  targetId: string,
  position: DropPosition,
): boolean {
  if (!canDropInMaster(def, ids, targetId, position)) return false
  // resolve the slot BEFORE detaching: pulling the nodes out shifts the
  // indices the target sits at
  const slot = resolveSlot(def, targetId, position)
  if (!slot) return false
  const anchor = slot.parent.children[slot.index] ?? null
  const moved = detachNodes(def, ids)
  if (!moved.length) return false
  const at = anchor ? slot.parent.children.indexOf(anchor) : slot.parent.children.length
  slot.parent.children.splice(at === -1 ? slot.parent.children.length : at, 0, ...moved)
  return true
}

export function duplicateInMaster(def: ComponentDef, ids: string[]): ElementNode[] {
  const made: ElementNode[] = []
  for (const id of ids) {
    const node = findNode([def.root], id)
    if (!node || isRoot(def, node)) continue
    const parent = masterParentOf(def, id)
    if (!parent) continue
    // fresh ids and internal targetIds remapped, exactly as a component copy
    const { cloned } = cloneForMaster(node)
    parent.children.splice(parent.children.indexOf(node) + 1, 0, cloned)
    made.push(cloned)
  }
  return made
}

/** Wraps a contiguous run of siblings in a new `:div`. */
export function wrapInMaster(def: ComponentDef, ids: string[]): ElementNode | null {
  const nodes = ids
    .map((id) => findNode([def.root], id))
    .filter((n): n is ElementNode => !!n && !isRoot(def, n))
  if (!nodes.length) return null
  const parent = masterParentOf(def, nodes[0]!.id)
  if (!parent || nodes.some((n) => masterParentOf(def, n.id) !== parent)) return null
  const at = parent.children.indexOf(nodes[0]!)
  const wrapper = createNode('div')
  for (const node of nodes) parent.children.splice(parent.children.indexOf(node), 1)
  wrapper.children = nodes
  parent.children.splice(at, 0, wrapper)
  return wrapper
}

export function retypeInMaster(def: ComponentDef, id: string, type: string): boolean {
  const node = findNode([def.root], id)
  if (!node || isRoot(def, node) || isComponentType(type)) return false
  // changing a container into a leaf would orphan its children
  if (node.children.length && isLeafElement(type)) return false
  node.type = type
  return true
}

/**
 * Pushes a master's current structure out to every instance of it, on every
 * page. Returns how many instance blocks were rewritten.
 *
 * Every CLOSED instance is rewritten unconditionally — deliberately NOT gated
 * on a structure signature the way `syncStructure` is, because that signature
 * is type-only: an arg or link change leaves it identical and would never
 * reach the instances.
 */
export function pushMasterStructure(project: Project, def: ComponentDef): number {
  // a library preview is not in the project; instances match by NAME, so
  // pushing one would rewrite blocks belonging to a real component of the
  // same name
  if (!project.components.some((c) => c.id === def.id)) return 0
  let rewritten = 0
  for (const page of project.pages) {
    // legacy `:Card:` leaves carry no block to rewrite — materialize them
    // first so they follow the master like everything else
    expandLeafInstances(page, def)
    const ids: string[] = []
    walkNodes(page.elements, (n) => {
      if (n.type === def.name) ids.push(n.id)
    })
    // bottom-up: rewriting a block shifts the lines of everything after it
    const ordered = ids
      .map((id) => findNode(page.elements, id))
      .filter((n): n is ElementNode => !!n && n.line !== undefined)
      .sort((a, b) => b.line! - a.line!)
      .map((n) => n.id)
    for (const id of ordered) {
      const node = findNode(page.elements, id)
      if (node && isClosedBlock(page, node, def.name) && rewriteInstanceBlock(page, node, def)) {
        rewritten++
      }
    }
    const marked = applyNodeMarkers(page.code, page.elements)
    if (marked !== page.code) page.code = marked
  }
  return rewritten
}

/**
 * Regenerates one instance's inner code lines from its master.
 *
 * Lifted out of `useComponents` so the master-first operations above can reuse
 * it; it closed over nothing. (`packages/guano/mcp/tools.mjs` keeps its own
 * copy for the agent path — the two must stay in step.)
 */
export function rewriteInstanceBlock(page: Page, node: ElementNode, def: ComponentDef): boolean {
  if (node.line === undefined) return false
  const lines = page.code.split('\n')
  const start = node.line
  const end = node.endLine ?? node.line
  if (end <= start) return false
  const indent = indentOf(lines[start]!)
  const inner = def.root.children.flatMap((c) => serializeNode(c, `${indent}\t`))
  const oldInnerLength = end - start - 1
  const rest = [...lines.slice(0, start + 1), ...inner, ...lines.slice(end)]
  // signature-aware inner map (exact line, then token type) so an inserted
  // master node doesn't re-seat every following instance node — and its
  // content overrides — one line off
  const align = alignInstanceLines(lines.slice(start + 1, end), inner)
  const map = new Map<number, number>()
  for (let i = 0; i < rest.length; i++) {
    if (i <= start) map.set(i, i)
    else if (i < start + 1 + inner.length) {
      const oldInner = align.get(i - (start + 1))
      if (oldInner !== undefined) map.set(i, start + 1 + oldInner)
    } else {
      map.set(i, i - inner.length + oldInnerLength)
    }
  }
  const before = page.code
  page.code = rest.join('\n')
  page.elements = reconcile(before, page.code, page.elements, map)
  return true
}

/** a block only counts once its close line exists — while an edit is mid-flight
 * the parser sees an unclosed block that swallows whatever follows, and syncing
 * from that would corrupt the master */
export function isClosedBlock(page: Page, node: ElementNode, name: string): boolean {
  if (node.line === undefined || node.endLine === undefined || node.endLine <= node.line) {
    return false
  }
  return page.code.split('\n')[node.endLine]?.trim() === `${name}:`
}

/**
 * Deletes a component, detaching every instance first so no page loses its
 * content. Interactions and design tokens the component used stay in the
 * project — they are shared libraries, and the detached elements still use
 * them.
 */
export function deleteComponent(project: Project, id: string): boolean {
  const def = project.components.find((c) => c.id === id)
  if (!def) return false
  detachComponentInstances(project, def)
  project.components = project.components.filter((c) => c.id !== id)
  return true
}
