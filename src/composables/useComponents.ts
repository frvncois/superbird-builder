import { computed, effectScope, watch } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { useElement } from './useElement'
import { reconcile } from '@/lib/syntax'
import {
  normalizeComponentName,
  isComponentType,
  hoistBlockRef,
  adoptStructure,
  cloneForMaster,
  stripExtractedInstanceState,
} from '@/lib/components'
import {
  componentUsage,
  alignMirrors,
  isClosedBlock,
  rewriteInstanceBlock,
  deleteComponent as deleteComponentFromProject,
  detachInstance,
  duplicateComponent as duplicateComponentInProject,
  renameComponent as renameComponentInProject,
  setComponentCategory,
} from '@/lib/componentOps'
import { catalogEntry, materializeCatalogEntry } from '@/lib/catalog'
import { useSettings } from './useSettings'
import { findNode, walkNodes } from '@/lib/tree'
import {
  buildInstanceMap,
  dependencyOrder,
  isNodeHidden,
  setNodeHidden,
  type InstanceMapping,
} from '@/lib/instances'
import { useAuth } from './useAuth'
import { useComponentBoard } from './useComponentBoard'
import type { ComponentDef, ElementNode, Page } from '@/types/editor'

let syncStarted = false
let syncing = false

/** what a page node inside a component instance stands for — see lib/instances */
export type MasterMapping = InstanceMapping

// project / active page / components / masterMap live at MODULE scope so
// every renderer node shares ONE masterMap computed instead of building
// its own tree-walking copy (that was O(n²) per page). useProject()/
// usePage() only wire computeds over singleton refs — safe to call here.
const { project } = useProject()
const { activePage } = usePage()
const { selectedElement } = useElement()

const components = computed(() => project.value.components)

const { cards, boardActive } = useComponentBoard()

/** what a name can resolve to right now: the project's components, plus — on
 *  the board — the library previews it shows, which hold instances of each
 *  other by name exactly as project components do */
const resolvable = computed(() =>
  boardActive.value
    ? [...components.value, ...cards.value.filter((c) => c.preview).map((c) => c.def)]
    : components.value,
)

function findComponent(name: string): ComponentDef | null {
  return resolvable.value.find((c) => c.name === name) ?? null
}

/**
 * Maps page nodes living inside component instance blocks to their
 * master nodes, by structural position (index + type). Mapped nodes
 * render/edit the shared master's style and interactions while
 * keeping their own content.
 */
// On the board the trees on screen are the masters themselves, so what needs
// mapping there is what they HOLD: the instances nested in them.
const masterMap = computed(() =>
  boardActive.value
    ? buildInstanceMap(
        cards.value.flatMap((card) => card.def.root.children),
        resolvable.value,
      )
    : buildInstanceMap(activePage.value.elements, components.value),
)

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

/** is this node hidden, by its own flag or its component's? */
function isHidden(node: ElementNode): boolean {
  return node.type !== 'body' && isNodeHidden(node, masterFor(node.id))
}

/**
 * Show or hide a node. Inside a component instance this is the INSTANCE's own
 * choice; on the components board it is the component's default for all of
 * them. Not a structural edit — the code does not change — but still not
 * something a contributor may do: the server keeps it out of their allowlist.
 */
function setHidden(node: ElementNode, hidden: boolean): void {
  if (node.type === 'body' || !useAuth().canBuild.value) return
  setNodeHidden(node, masterFor(node.id), hidden)
}

export function useComponents() {
  const { selectElement } = useElement()

  // --- structural sync: edits inside one instance reshape the master
  // and every other instance follows ---

  // a nested instance is OPAQUE in its host's signature: what is inside it is
  // another component's structure, and a change there must not make every
  // host look divergent (it would be adopted straight back over the change)
  function structureSig(node: ElementNode, top = true): string {
    if (!top && isComponentType(node.type)) return node.type
    return node.children.length
      ? `${node.type}(${node.children.map((child) => structureSig(child, false)).join()})`
      : node.type
  }

  // adoptStructure (signature-LCS identity carry) is shared with the MCP
  // server — imported from @/lib/components so both surfaces reshape masters
  // identically.

  /**
   * After any code change: a properly closed instance whose structure
   * diverged from its master was just edited — adopt its shape into the
   * master, then rewrite every other closed instance (all pages) to match.
   */
  function syncStructure() {
    // inner components first: a host adopts a nested block's structure along
    // with its own, so that block has to be current by the time it does
    for (const def of dependencyOrder(components.value)) {
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
      if (source) {
        adoptStructure(def.root, source.node, def.name)
        // a nested instance that arrived this way came in as plain nodes; what
        // the master holds has to be a mirror of its component, and every
        // OTHER host's mirror of this one has to follow its new shape
        alignMirrors(components.value)
      }

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

  /**
   * Copies a library entry into the project as an ordinary component, adding
   * the design tokens and shared effects it needs. Nothing links back to the
   * catalog afterwards. Returns what was created, so the drawer can say so.
   */
  function addFromCatalog(key: string): { def: ComponentDef; tokens: string[] } | null {
    const entry = catalogEntry(key)
    if (!entry) return null
    // what the entry holds comes first: the component the project already made
    // from it, else that entry added right here — so the whole family lands in
    // one tick, and one undo step
    const made = materializeCatalogEntry(
      entry,
      project.value,
      (held) =>
        project.value.components.find((c) => c.source === held) ??
        addFromCatalog(held)?.def ??
        null,
    )
    // one synchronous tick: tokens first, so the classes referencing them are
    // valid the moment the component exists, and one undo step for the lot
    const tokens = useSettings().ensureTokens(made.tokens)
    if (made.interactions.length) project.value.interactions.push(...made.interactions)
    project.value.components.push(made.def)
    return { def: made.def, tokens }
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
    isHidden,
    setHidden,
    findMasterNode,
    createComponent,
    detachComponent,
    addFromCatalog,
    renameComponent,
    duplicateComponent,
    setCategory,
    usageOf,
    deleteComponent,
  }
}
