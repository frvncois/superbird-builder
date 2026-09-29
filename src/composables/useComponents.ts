import { computed, effectScope, watch } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { useElement } from './useElement'
import { reconcile } from '@/lib/syntax'
import {
  normalizeComponentName,
  isComponentType,
  hoistBlockRef,
  serializeNode,
  adoptStructure,
  cloneForMaster,
  stripExtractedInstanceState,
  alignInstanceLines,
} from '@/lib/components'
import {
  componentUsage,
  deleteComponent as deleteComponentFromProject,
  detachInstance,
  duplicateComponent as duplicateComponentInProject,
  renameComponent as renameComponentInProject,
  setComponentCategory,
} from '@/lib/componentOps'
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
const { selectedElement } = useElement()

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

/**
 * The node a panel should WRITE to for the current selection.
 *
 * Style, interactions and animations are shared across a component's
 * instances, so editing them inside an instance must land on the master —
 * otherwise the structural sync watcher overwrites the edit on the next
 * structural change, silently. Content stays per-instance and does NOT go
 * through this.
 */
const editTarget = computed(() => {
  const selected = selectedElement.value
  if (!selected) return null
  return masterFor(selected.id)?.master ?? selected
})

export function useComponents() {
  const { selectElement } = useElement()

  // --- structural sync: edits inside one instance reshape the master
  // and every other instance follows ---

  function structureSig(node: ElementNode): string {
    return node.children.length
      ? `${node.type}(${node.children.map(structureSig).join()})`
      : node.type
  }

  // adoptStructure (signature-LCS identity carry) is shared with the MCP
  // server — imported from @/lib/components so both surfaces reshape masters
  // identically.

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
    // master ids are their own id space; internal binding targetIds are
    // remapped onto them so a modal/accordion keeps working as a component
    const { cloned } = cloneForMaster(source)
    // the master now owns presentation AND content — clear the source nodes so
    // the instance inherits instead of shadowing (a shadow re-translates shared
    // chrome per page and can re-seat onto the wrong node on restructure)
    stripExtractedInstanceState(source)
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
    // a ref on the extracted block's root moves onto the instance wrapper;
    // refs further in are dropped (they'd be cloned into every instance)
    const hoisted = hoistBlockRef(lines.slice(start, end + 1))
    const rest = [
      ...lines.slice(0, start),
      `${indent}:${name}${hoisted.ref ? `#${hoisted.ref}` : ''}`,
      ...hoisted.lines.map((l) => `\t${l}`),
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
   * Unlinks a component instance: the shared master's style, interactions and
   * content are baked onto the inner page nodes and the `:Name … Name:`
   * wrapper is dissolved. The block is now independent — editing it no longer
   * touches other instances.
   */
  function detachComponent(instanceId: string) {
    if (detachInstance(project.value, activePage.value, instanceId)) selectElement(instanceId)
  }

  /** Renames a component and every instance token in the project. */
  function renameComponent(id: string, rawName: string): string | null {
    return renameComponentInProject(project.value, id, rawName)
  }

  /** Copies a component under a new name; the copy has no instances yet. */
  function duplicateComponent(id: string): ComponentDef | null {
    return duplicateComponentInProject(project.value, id)
  }

  function setCategory(id: string, category: string) {
    setComponentCategory(project.value, id, category)
  }

  /** Where a component is used — the numbers the delete confirm quotes. */
  function usageOf(name: string) {
    return componentUsage(project.value, name)
  }

  /**
   * Deletes a component. Every instance is detached first, so pages keep the
   * elements and their look — nothing vanishes from the site.
   */
  function deleteComponent(id: string): boolean {
    return deleteComponentFromProject(project.value, id)
  }

  return {
    components,
    findComponent,
    masterFor,
    editTarget,
    findMasterNode,
    createComponent,
    detachComponent,
    renameComponent,
    duplicateComponent,
    setCategory,
    usageOf,
    deleteComponent,
  }
}
