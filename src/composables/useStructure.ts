import { computed, ref, type ComputedRef } from 'vue'
import { useElement, type DropPosition, type ElementBlock } from './useElement'
import { useComponents } from './useComponents'
import { useReorderAnimation } from './useReorderAnimation'
import { elementBlockLines } from '@/lib/syntax'
import { expandComponentInstances, isComponentType } from '@/lib/components'
import type { ElementNode } from '@/types/editor'

/**
 * The one way to change structure, whatever is being edited.
 *
 * Two things are structural in this app and they are shaped very differently:
 * a PAGE tree, where `page.code` is authoritative and every change is a code
 * splice plus a reconcile; and a component MASTER tree, which is a plain
 * ElementNode tree with no code, whose changes must then be pushed out to
 * every instance. Callers — the Layers tree, the canvas, the ⌘E dock, the
 * context menu, the shortcuts, the Data panel — want neither of those
 * vocabularies; they want "move this there" and "can I?".
 *
 * So this exposes one backend at a time and answers the capability questions
 * (`isContainer`, `can`, `canDrop`) that nothing used to answer: the page ops
 * simply fail silently on an illegal move, which is fine for a text editor
 * where you can see the result and unusable for a tree that has to grey out
 * a drop target before you release the mouse.
 */

/** what an insert puts down */
export type InsertPayload =
  | { kind: 'element'; type: string }
  | { kind: 'component'; name: string }
  /** a bundled library entry — using it copies it into the project first */
  | { kind: 'catalog'; key: string }

export type StructureAction =
  | 'move'
  | 'remove'
  | 'duplicate'
  | 'wrap'
  | 'retype'
  | 'ref'
  | 'arg'
  | 'link'

export interface StructureBackend {
  kind: 'page' | 'master'
  /** the tree(s) the Layers panel renders */
  roots: ComputedRef<ElementNode[]>
  /** can this node hold children? */
  isContainer: (node: ElementNode) => boolean
  can: (node: ElementNode, action: StructureAction) => boolean
  canDrop: (ids: string[], targetId: string, position: DropPosition) => boolean
  insert: (payload: InsertPayload, targetId: string | null, position: DropPosition) => ElementNode | null
  move: (ids: string[], targetId: string, position: DropPosition) => void
  /** keyboard move: one visual slot up or down */
  nudge: (dir: 'up' | 'down') => boolean
  remove: (ids: string[]) => void
  duplicate: (ids: string[]) => void
  wrap: (ids: string[]) => void
  retype: (id: string, type: string) => void
  setArg: (id: string, arg: string | null) => void
  setLink: (id: string, link: string | null) => void
  /** refs are page-scope addresses; masters never carry one */
  setRef: (id: string, ref: string | null) => boolean
  copy: (ids: string[]) => void
  paste: (targetId: string) => void
}

/** the app-internal element clipboard (elements aren't representable in the
 *  OS one). Module-level so it survives every unmount. */
const clipboard = ref<ElementBlock | null>(null)

export function useStructure() {
  const el = useElement()
  const { components, findComponent, masterFor, addFromCatalog } = useComponents()
  const { canvasReorder } = useReorderAnimation()

  // --- shared helpers ---

  /** a page node is a container when its block has a distinct close line */
  const pageIsContainer = (node: ElementNode) =>
    node.line !== undefined && (node.endLine ?? node.line) > node.line

  /** the code lines a payload expands to, or null when it can't be placed */
  function blockFor(payload: InsertPayload): string[] | null {
    if (payload.kind === 'element') return elementBlockLines(payload.type)
    const name =
      payload.kind === 'catalog' ? addFromCatalog(payload.key)?.def.name : payload.name
    if (!name || !findComponent(name)) return null
    return expandComponentInstances(`:${name}:`, components.value).split('\n')
  }

  // --- the page backend ---

  const page: StructureBackend = {
    kind: 'page',
    roots: computed(() => el.elements.value),
    isContainer: pageIsContainer,

    can(node, action) {
      if (node.type === 'body') return false
      if (action === 'retype') return true
      return true
    },

    canDrop(ids, targetId, position) {
      const target = el.getElement(targetId)
      if (!target) return false
      // the body only ever takes children
      if (target.type === 'body') return position === 'inside'
      if (position === 'inside' && !pageIsContainer(target)) return false
      for (const id of ids) {
        if (id === targetId) return false
        const node = el.getElement(id)
        if (!node || node.type === 'body') return false
        // never into its own subtree
        if (node.line !== undefined) {
          const end = node.endLine ?? node.line
          if (target.line !== undefined && target.line >= node.line && target.line <= end) {
            return false
          }
        }
      }
      return true
    },

    insert(payload, targetId, position) {
      const target = targetId ? el.getElement(targetId) : el.selectedElement.value
      if (!target) return null
      // components cannot nest: refuse a component landing inside an instance
      if (payload.kind !== 'element') {
        const mapping = masterFor(target.id)
        if (mapping || isComponentType(target.type)) return null
      }
      const block = blockFor(payload)
      if (!block) return null
      return el.insertElementBlock(block, target.id, position)
    },

    move(ids, targetId, position) {
      if (!this.canDrop(ids, targetId, position)) return
      // one element animates on the canvas; a group has no single ghost
      if (ids.length === 1) canvasReorder(ids[0]!, targetId, position)
      else for (const id of [...ids].reverse()) el.reorderElement(id, targetId, position)
    },

    nudge(dir) {
      if (el.isMultiSelect.value) return el.moveSelectionGroup(dir)
      return nudgeOne(dir)
    },

    remove(ids) {
      const real = ids.filter((id) => el.getElement(id)?.type !== 'body')
      if (!real.length) return
      if (real.length === 1) {
        el.removeElement(real[0]!)
        return
      }
      // removeElements splices min-line..max-endLine wholesale, so it is only
      // safe for one contiguous run of siblings — anything else goes one at a
      // time, bottom-up so the earlier lines stay put
      if (isContiguousRun(real)) {
        el.removeElements(real)
        return
      }
      const ordered = real
        .map((id) => el.getElement(id))
        .filter((n): n is ElementNode => !!n && n.line !== undefined)
        .sort((a, b) => b.line! - a.line!)
      for (const node of ordered) el.removeElement(node.id)
    },

    duplicate(ids) {
      const real = ids.filter((id) => el.getElement(id)?.type !== 'body')
      if (!real.length) return
      const block =
        real.length > 1 ? el.copyElementsBlock(real) : el.copyElementBlock(real[0]!)
      if (block) el.pasteElementBlock(real[real.length - 1]!, block)
    },

    wrap(ids) {
      if (ids.some((id) => el.getElement(id)?.type === 'body')) return
      el.wrapSelectionInDiv()
    },

    retype: (id, type) => el.changeElementType(id, type),
    setArg: (id, arg) => el.setElementArg(id, arg),
    setLink: (id, link) => el.setElementLink(id, link),
    setRef: (id, ref) => el.setElementRef(id, ref),

    copy(ids) {
      const real = ids.filter((id) => el.getElement(id)?.type !== 'body')
      if (!real.length) return
      const block =
        real.length > 1 ? el.copyElementsBlock(real) : el.copyElementBlock(real[0]!)
      if (block) clipboard.value = block
    },

    paste(targetId) {
      if (clipboard.value) el.pasteElementBlock(targetId, clipboard.value)
    },
  }

  /** are these ids one unbroken run of siblings? */
  function isContiguousRun(ids: string[]): boolean {
    const nodes = ids.map((id) => el.getElement(id)).filter((n): n is ElementNode => !!n)
    if (nodes.length !== ids.length) return false
    return nodes.every((n) => el.selectedElementIds.value.includes(n.id))
  }

  /**
   * Moves the selection one visual slot, mirroring a drag: it descends into an
   * adjacent block, escapes its parent at a boundary, or swaps with a sibling.
   * Ported from the code editor's gutter keyboard move — it was the only place
   * an element could be re-parented without the mouse.
   */
  function nudgeOne(dir: 'up' | 'down'): boolean {
    const s = el.selectedElement.value
    if (!s || s.type === 'body' || s.line === undefined) return false
    const sEnd = s.endLine ?? s.line
    // a component instance is opaque: its interior maps to a shared master, so
    // we swap past it rather than descending in
    const opaque = (node: ElementNode) => isComponentType(node.type)
    const go = (targetId: string, position: DropPosition) => {
      canvasReorder(s.id, targetId, position)
      return true
    }

    if (dir === 'up') {
      const prev = s.line - 1
      if (prev < 0) return false
      const p = el.elementAtLine(prev)
      if (!p || p.id === s.id) return false
      if (p.endLine === prev && p.line !== undefined && p.line < prev) {
        // prev is p's close line → preceding sibling block: descend as its
        // last child (empty block → straight inside; opaque → swap past)
        if (opaque(p)) return go(p.id, 'before')
        if (!p.children.length) return go(p.id, 'inside')
        return go(p.children[p.children.length - 1]!.id, 'after')
      }
      // p's open line (S is its first child → escape) or a leaf sibling (swap)
      return go(p.id, 'before')
    }

    const next = sEnd + 1
    const n = el.elementAtLine(next)
    if (!n || n.id === s.id) return false
    if (n.line === next && (n.endLine ?? n.line) > next) {
      // next is n's open line → following sibling block: descend as its first
      // child (empty block → straight inside; opaque → swap past)
      if (opaque(n)) return go(n.id, 'after')
      if (!n.children.length) return go(n.id, 'inside')
      return go(n.children[0]!.id, 'before')
    }
    // n's close line (S is its last child → escape) or a leaf sibling (swap)
    return go(n.id, 'after')
  }

  /** the backend for whatever is being edited right now */
  const backend = computed<StructureBackend>(() => page)

  return { backend, clipboard }
}
