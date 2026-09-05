import { computed, effectScope, watch } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { useElement } from './useElement'
import { reconcile } from '@/lib/syntax'
import { normalizeComponentName, isComponentType, serializeNode } from '@/lib/components'
import { findNode, walkNodes } from '@/lib/tree'
import type { ComponentDef, ElementNode, Page } from '@/types/editor'

let syncStarted = false
let syncing = false

export interface MasterMapping {
  /** shared master node this page node corresponds to */
  master: ElementNode
  /** page node of the :Name … Name: instance block */
  instanceId: string
  /** the component's master root, for interaction lookups */
  root: ElementNode
}

// project / active page / components / masterMap live at MODULE scope so
// every renderer node shares ONE masterMap computed instead of building
// its own tree-walking copy (that was O(n²) per page). useProject()/
// usePage() only wire computeds over singleton refs — safe to call here.
const { project } = useProject()
const { activePage } = usePage()

const components = computed(() => project.value.components)

function findComponent(name: string): ComponentDef | null {
  return components.value.find((c) => c.name === name) ?? null
}

/**
 * Maps page nodes living inside component instance blocks to their
 * master nodes, by structural position (index + type). Mapped nodes
 * render/edit the shared master's style and interactions while
 * keeping their own content.
 */
const masterMap = computed(() => {
  const map = new Map<string, MasterMapping>()
  const pair = (inst: ElementNode, master: ElementNode, instanceId: string, root: ElementNode) => {
    if (inst.type !== master.type) return
    map.set(inst.id, { master, instanceId, root })
    const length = Math.min(inst.children.length, master.children.length)
    for (let i = 0; i < length; i++) {
      pair(inst.children[i]!, master.children[i]!, instanceId, root)
    }
  }
  walkNodes(activePage.value.elements, (node) => {
    if (!isComponentType(node.type)) return
    const def = findComponent(node.type)
    // the instance block itself maps to the master root
    if (def) pair(node, def.root, node.id, def.root)
  })
  return map
})

function masterFor(nodeId: string): MasterMapping | null {
  return masterMap.value.get(nodeId) ?? null
}

export function useComponents() {
  const { selectElement, changeElementType } = useElement()

  // --- structural sync: edits inside one instance reshape the master
  // and every other instance follows ---

  function structureSig(node: ElementNode): string {
    return node.children.length
      ? `${node.type}(${node.children.map(structureSig).join()})`
      : node.type
  }

  /** reshape master children to match an edited instance, keeping the
   * styled master node wherever a same-type child survives; a component
   * can never contain itself (infinite loop) */
  function adoptStructure(master: ElementNode, edited: ElementNode, selfName: string) {
    const pool = [...master.children]
    master.children = edited.children
      .filter((child) => child.type !== selfName)
      .map((child) => {
        const at = pool.findIndex((m) => m.type === child.type)
        const node: ElementNode =
          at !== -1
            ? pool.splice(at, 1)[0]!
            : {
                id: crypto.randomUUID(),
                type: child.type,
                content: child.content,
                locales: child.locales ? JSON.parse(JSON.stringify(child.locales)) : undefined,
                conditions: child.conditions
                  ? JSON.parse(JSON.stringify(child.conditions))
                  : undefined,
                children: [],
              }
        adoptStructure(node, child, selfName)
        return node
      })
  }

  /** regenerate a stale instance's inner code lines from the master */
  function rewriteInstanceBlock(page: Page, node: ElementNode, def: ComponentDef) {
    if (node.line === undefined) return
    const lines = page.code.split('\n')
    const start = node.line
    const end = node.endLine ?? node.line
    if (end <= start) return
    const indent = lines[start]!.match(/^\t*/)![0]
    const inner = def.root.children.flatMap((c) => serializeNode(c, `${indent}\t`))
    const oldInnerLength = end - start - 1
    const rest = [...lines.slice(0, start + 1), ...inner, ...lines.slice(end)]
    // positional inner map so same-type lines keep their nodes (content!)
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) {
      if (i <= start) map.set(i, i)
      else if (i < start + 1 + inner.length) {
        const innerIndex = i - (start + 1)
        if (innerIndex < oldInnerLength) map.set(i, start + 1 + innerIndex)
      } else {
        map.set(i, i - inner.length + oldInnerLength)
      }
    }
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)
  }

  /** a block only counts once its close line exists — while the user is
   * mid-typing ':Hero', the parser sees an unclosed block that swallows
   * whatever follows, and syncing from that would corrupt the master */
  function isClosedBlock(page: Page, node: ElementNode, name: string): boolean {
    if (node.line === undefined || node.endLine === undefined || node.endLine <= node.line) {
      return false
    }
    return page.code.split('\n')[node.endLine]?.trim() === `${name}:`
  }

  /**
   * After any code change: a properly closed instance whose structure
   * diverged from its master was just edited — adopt its shape into the
   * master, then rewrite every other closed instance (all pages) to match.
   */
  function syncStructure() {
    for (const def of components.value) {
      const instances: { page: Page; node: ElementNode }[] = []
      for (const page of project.value.pages) {
        walkNodes(page.elements, (n) => {
          if (n.type === def.name) instances.push({ page, node: n })
        })
      }
      if (!instances.length) continue

      const closed = instances.filter((i) => isClosedBlock(i.page, i.node, def.name))
      const masterSig = structureSig(def.root)
      const divergent = closed.filter((i) => structureSig(i.node) !== masterSig)
      if (!divergent.length) continue

      // never adopt an empty block over a populated master — that's a
      // transient state, not a deliberate "delete everything"
      const source = divergent.find(
        (i) => i.node.children.length > 0 || def.root.children.length === 0,
      )
      if (source) adoptStructure(def.root, source.node, def.name)

      const nextSig = structureSig(def.root)
      for (const { page, node } of closed) {
        if (structureSig(node) !== nextSig) rewriteInstanceBlock(page, node, def)
      }
    }
  }

  // one detached watcher for the whole app: any page-code mutation
  // (typing, reorder, paste, delete) triggers a structure sync
  if (!syncStarted) {
    syncStarted = true
    const scope = effectScope(true)
    scope.run(() => {
      watch(
        () => project.value.pages.map((p) => p.code).join('\x00'),
        () => {
          if (syncing) return
          syncing = true
          try {
            syncStructure()
          } finally {
            syncing = false
          }
        },
      )
    })
  }

  /** find a master node by id across every component (for target labels) */
  function findMasterNode(id: string): ElementNode | null {
    for (const def of components.value) {
      const match = findNode([def.root], id)
      if (match) return match
    }
    return null
  }

  /**
   * Turns an element into a shared component: its subtree is cloned as
   * the master, and its code block is wrapped in :Name … Name: — the
   * structure stays fully editable in the code.
   */
  function createComponent(rawName: string, sourceId: string): ComponentDef | null {
    const page = activePage.value
    const source = findNode(page.elements, sourceId)
    if (!source || source.line === undefined || source.type === 'body') return null
    if (isComponentType(source.type) || masterFor(source.id)) return null

    const name = normalizeComponentName(rawName, components.value.map((c) => c.name))
    const cloned = JSON.parse(JSON.stringify(source)) as ElementNode
    walkNodes([cloned], (n) => {
      n.id = crypto.randomUUID() // master ids are their own id space
      delete n.line
      delete n.endLine
    })
    // the root is a component-typed container: it maps to the :Name
    // wrapper itself, so the wrapper can carry shared styles too
    const root: ElementNode = { id: crypto.randomUUID(), type: name, content: '', children: [cloned] }
    const def: ComponentDef = { id: crypto.randomUUID(), name, root }
    project.value.components.push(def)

    // wrap the block: open line, inner lines one level deeper, close line
    const lines = page.code.split('\n')
    const start = source.line
    const end = source.endLine ?? source.line
    const indent = lines[start]!.match(/^\t*/)![0]
    const rest = [
      ...lines.slice(0, start),
      `${indent}:${name}`,
      ...lines.slice(start, end + 1).map((l) => `\t${l}`),
      `${indent}${name}:`,
      ...lines.slice(end + 1),
    ]
    // exact line map: inner lines shift down one, the wrap lines are new
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) {
      if (i < start) map.set(i, i)
      else if (i >= start + 1 && i <= end + 1) map.set(i, i - 1)
      else if (i > end + 2) map.set(i, i - 2)
    }
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)

    // select the new instance block
    let instance: ElementNode | null = null
    walkNodes(page.elements, (n) => {
      if (n.line === start && n.type === name && !instance) instance = n
    })
    if (instance) selectElement((instance as ElementNode).id)
    return def
  }

  /**
   * Unlinks a component instance: the shared master's style and
   * interactions are baked onto the (already plain) inner page nodes,
   * then the :Name … Name: wrapper becomes a plain :div. The block is
   * now independent — editing it no longer touches other instances.
   */
  function detachComponent(instanceId: string) {
    const page = activePage.value
    const instance = findNode(page.elements, instanceId)
    if (!instance || !isComponentType(instance.type) || !findComponent(instance.type)) return

    // pair each instance node with its master, and remember master→instance
    // ids so interaction targets can be rewired to this instance
    const pairs: { node: ElementNode; master: ElementNode }[] = []
    const masterToInstance = new Map<string, string>()
    walkNodes([instance], (node) => {
      const mapping = masterFor(node.id)
      if (mapping) {
        pairs.push({ node, master: mapping.master })
        masterToInstance.set(mapping.master.id, node.id)
      }
    })

    for (const { node, master } of pairs) {
      if (master.classes) node.classes = master.classes
      if (master.interactions?.length) {
        node.interactions = master.interactions.map((i) => ({
          ...i,
          id: crypto.randomUUID(),
          targetId: i.targetId ? (masterToInstance.get(i.targetId) ?? i.targetId) : null,
        }))
      }
      if (master.conditions) {
        const spec = JSON.parse(JSON.stringify(master.conditions))
        for (const rule of spec.rules) rule.id = crypto.randomUUID()
        node.conditions = spec
      }
    }

    // the wrapper becomes a real element; its children are already plain
    changeElementType(instanceId, 'div')
    // re-derive the tree from the (now consistent) code so the canvas's
    // component mapping recomputes cleanly for THIS block only — other
    // instances keep their identity (same code → identity line map)
    activePage.value.elements = reconcile(
      activePage.value.code,
      activePage.value.code,
      activePage.value.elements,
    )
    selectElement(instanceId)
  }

  return {
    components,
    findComponent,
    masterFor,
    findMasterNode,
    createComponent,
    detachComponent,
  }
}
