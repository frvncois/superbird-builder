import { computed, ref } from 'vue'
import { usePage } from './usePage'
import { reconcile } from '@/lib/syntax'
import { isKnownElement } from '@/lib/elements'
import { findNode, walkNodes } from '@/lib/tree'
import type { ElementNode, Interaction } from '@/types/editor'

/** per-node settings captured alongside a copied code block, DFS order */
interface NodeProps {
  classes?: string
  content?: string
  htmlId?: string
  src?: string
  link?: string
  locales?: ElementNode['locales']
  interactions?: Interaction[]
}

/** a copied element: its dedented code lines + every node's settings */
export interface ElementBlock {
  code: string[]
  props: NodeProps[]
}

const selectedElementId = ref<string | null>(null)

// bumped to ask the code editor to focus the caret on the current
// selection's line (e.g. after inserting from the ⌘E dock)
const editorFocusTick = ref(0)

export type DropPosition = 'before' | 'after' | 'inside'

// shared drag state so the canvas, the code editor and palette drags
// stay in sync ('inside' is only produced by palette insert-drags)
const draggingId = ref<string | null>(null)
const dropTarget = ref<{ id: string; position: DropPosition } | null>(null)

export function useElement() {
  const { activePage } = usePage()

  const elements = computed(() => activePage.value?.elements ?? [])

  const bodyElement = computed(() => elements.value.find((n) => n.type === 'body') ?? null)

  // the page body is the default selection — styling with nothing
  // picked styles the body, like any other element
  const selectedElement = computed(
    () =>
      (selectedElementId.value ? findNode(elements.value, selectedElementId.value) : null) ??
      bodyElement.value,
  )

  function getElement(id: string): ElementNode | null {
    return findNode(elements.value, id)
  }

  /** Innermost element whose source range contains the given code line */
  function elementAtLine(line: number): ElementNode | null {
    let best: ElementNode | null = null
    walkNodes(elements.value, (node) => {
      if (node.line !== undefined && node.line <= line && line <= (node.endLine ?? node.line)) {
        best = node
      }
    })
    return best
  }

  function updateElement(id: string, patch: Partial<Omit<ElementNode, 'id' | 'children'>>) {
    const node = findNode(elements.value, id)
    if (node) Object.assign(node, patch)
  }

  /**
   * Renames an element's type (e.g. section → header) by patching its
   * syntax tokens in the code and mutating the node in place — the
   * structure is unchanged, so no reparse and no identity loss.
   */
  function changeElementType(id: string, newType: string) {
    const page = activePage.value
    if (!page) return
    const node = findNode(page.elements, id)
    if (!node || node.line === undefined) return
    if (node.type === 'body' || node.type === newType || !isKnownElement(newType)) return

    const lines = page.code.split('\n')
    const oldType = node.type
    const openLine = lines[node.line]!
    if (openLine.trim() === `:${oldType}:`) {
      lines[node.line] = openLine.replace(`:${oldType}:`, `:${newType}:`)
    } else {
      lines[node.line] = openLine.replace(`:${oldType}`, `:${newType}`)
      const end = node.endLine
      if (end !== undefined && end !== node.line) {
        lines[end] = lines[end]!.replace(`${oldType}:`, `${newType}:`)
      }
    }
    page.code = lines.join('\n')
    node.type = newType
  }

  /**
   * Sets or clears an element token's (…) argument — field binding or
   * collection name — by patching the code line in place.
   */
  function setElementArg(id: string, arg: string | null) {
    const page = activePage.value
    const node = page ? findNode(page.elements, id) : null
    if (!page || !node || node.line === undefined) return
    const lines = page.code.split('\n')
    const line = lines[node.line]!
    const pattern = new RegExp(`(:${node.type})(\\([a-z0-9-]*\\))?`)
    lines[node.line] = line.replace(pattern, arg ? `$1(${arg})` : '$1')
    page.code = lines.join('\n')
    node.arg = arg || undefined
  }

  /** deletes an element's whole code block (code is the structural source) */
  function removeElement(id: string) {
    const page = activePage.value
    if (!page) return
    const node = findNode(page.elements, id)
    if (!node || node.line === undefined || node.type === 'body') return
    const length = (node.endLine ?? node.line) - node.line + 1
    const rest = page.code.split('\n')
    rest.splice(node.line, length)
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) map.set(i, i < node.line ? i : i + length)
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)
    if (selectedElementId.value === id) selectedElementId.value = null
  }

  /** snapshots an element for copy: dedented code block + all node settings */
  function copyElementBlock(id: string): ElementBlock | null {
    const page = activePage.value
    const node = page ? findNode(page.elements, id) : null
    if (!page || !node || node.line === undefined || node.type === 'body') return null
    const lines = page.code.split('\n').slice(node.line, (node.endLine ?? node.line) + 1)
    const depth = lines[0]!.match(/^\t*/)![0].length
    const code = lines.map((l) => l.replace(new RegExp(`^\\t{0,${depth}}`), ''))
    const props: NodeProps[] = []
    walkNodes([node], (n) =>
      props.push({
        classes: n.classes,
        content: n.content,
        htmlId: n.htmlId,
        src: n.src,
        link: n.link,
        locales: n.locales ? JSON.parse(JSON.stringify(n.locales)) : undefined,
        interactions: n.interactions ? JSON.parse(JSON.stringify(n.interactions)) : undefined,
      }),
    )
    return { code, props }
  }

  /**
   * Inserts a copied block as the sibling after the target (or as the
   * body's last child), then re-applies the captured settings onto the
   * freshly created nodes. Interaction ids are re-minted so the copy
   * never collides with the original.
   */
  function pasteElementBlock(targetId: string, block: ElementBlock): ElementNode | null {
    const page = activePage.value
    const target = page ? findNode(page.elements, targetId) : null
    if (!page || !target || target.line === undefined) return null

    const lines = page.code.split('\n')
    const intoBody = target.type === 'body'
    const targetEnd = target.endLine ?? target.line
    const indent = lines[target.line]!.match(/^\t*/)![0].length + (intoBody ? 1 : 0)
    const insertAt = intoBody ? targetEnd : targetEnd + 1
    const blockLines = block.code.map((l) => '\t'.repeat(indent) + l)

    const rest = [...lines]
    rest.splice(insertAt, 0, ...blockLines)
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) {
      if (i < insertAt) map.set(i, i)
      else if (i >= insertAt + blockLines.length) map.set(i, i - blockLines.length)
    }
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)

    // the pasted root is the shallowest node opening on the insert line
    let pasted: ElementNode | null = null
    walkNodes(page.elements, (n) => {
      if (n.line === insertAt && !pasted) pasted = n
    })
    if (pasted) {
      const created: ElementNode[] = []
      walkNodes([pasted], (n) => created.push(n))
      block.props.forEach((p, i) => {
        const n = created[i]
        if (!n) return
        if (p.classes) n.classes = p.classes
        if (p.content) n.content = p.content
        if (p.htmlId) n.htmlId = p.htmlId
        if (p.src) n.src = p.src
        if (p.link) n.link = p.link
        if (p.locales) n.locales = JSON.parse(JSON.stringify(p.locales))
        if (p.interactions) {
          n.interactions = p.interactions.map((x) => ({ ...x, id: crypto.randomUUID() }))
        }
      })
      selectedElementId.value = (pasted as ElementNode).id
    }
    return pasted
  }

  /**
   * Inserts a freshly serialized block (dedented lines from
   * elementBlockLines, or an already-expanded component block)
   * before/after a target element or as the last child inside a block
   * target. Code-first: splice + explicit map + reconcile, like paste.
   */
  function insertElementBlock(
    blockLines: string[],
    targetId: string,
    position: DropPosition,
  ): ElementNode | null {
    const page = activePage.value
    const target = page ? findNode(page.elements, targetId) : null
    if (!page || !target || target.line === undefined) return null

    // the body only ever accepts children; leaves have no inside
    if (target.type === 'body') position = 'inside'
    else if (position === 'inside' && (target.endLine ?? target.line) <= target.line)
      position = 'after'

    const lines = page.code.split('\n')
    const targetEnd = target.endLine ?? target.line
    const targetIndent = lines[target.line]!.match(/^\t*/)![0].length

    let insertAt: number
    let indent: number
    if (position === 'before') {
      insertAt = target.line
      indent = targetIndent
    } else if (position === 'after') {
      insertAt = targetEnd + 1
      indent = targetIndent
    } else {
      // last child: on the close line, pushing the close token down
      insertAt = targetEnd
      indent = targetIndent + 1
    }

    const indented = blockLines.map((l) => '\t'.repeat(indent) + l)
    const rest = [...lines]
    rest.splice(insertAt, 0, ...indented)
    // identity below the insert, shifted above; inserted lines are
    // unmapped so they become fresh nodes
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) {
      if (i < insertAt) map.set(i, i)
      else if (i >= insertAt + indented.length) map.set(i, i - indented.length)
    }
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)

    // the new root is the shallowest node opening on the insert line
    let created: ElementNode | null = null
    walkNodes(page.elements, (n) => {
      if (n.line === insertAt && !created) created = n
    })
    if (created) selectedElementId.value = (created as ElementNode).id
    return created
  }

  function selectElement(id: string | null) {
    selectedElementId.value = id
  }

  /** ask the code editor to move focus + caret onto the selection's line */
  function requestEditorFocus() {
    editorFocusTick.value++
  }

  function selectByLine(line: number) {
    selectElement(elementAtLine(line)?.id ?? null)
  }

  /**
   * Moves an element's whole source block before/after/inside another
   * element. Works on the page code (the source of truth), re-indents the
   * block to the destination depth, then reparses — so canvas and editor
   * both update from the same change. 'inside' appends as the target's last
   * child (only valid when the target is a block).
   */
  function reorderElement(dragId: string, targetId: string, position: DropPosition) {
    const page = activePage.value
    if (!page || dragId === targetId) return
    const drag = findNode(page.elements, dragId)
    const target = findNode(page.elements, targetId)
    if (!drag || !target || drag.line === undefined || target.line === undefined) return
    // the body wrap never moves; but it can receive children ('inside')
    if (drag.type === 'body' || (target.type === 'body' && position !== 'inside')) return

    const dragEnd = drag.endLine ?? drag.line
    const targetEnd = target.endLine ?? target.line
    // can't drop into your own block (covers dropping inside a descendant)
    if (target.line >= drag.line && targetEnd <= dragEnd) return
    // 'inside' only makes sense for a block (has a distinct close line)
    if (position === 'inside' && targetEnd <= target.line) return

    const lines = page.code.split('\n')
    const indentOf = (s: string) => s.match(/^\t*/)![0].length
    // inside → sit one level under the target; before/after → match it
    const destIndent = indentOf(lines[target.line]!) + (position === 'inside' ? 1 : 0)
    const delta = destIndent - indentOf(lines[drag.line]!)

    const block = lines
      .slice(drag.line, dragEnd + 1)
      .map((l) =>
        delta >= 0 ? '\t'.repeat(delta) + l : l.replace(new RegExp(`^\\t{0,${-delta}}`), ''),
      )

    const rest = [...lines]
    rest.splice(drag.line, block.length)

    // before → target's open line; inside → its close line (last child);
    // after → just past its close line
    let insert =
      position === 'before' ? target.line : position === 'inside' ? targetEnd : targetEnd + 1
    if (dragEnd < insert) insert -= block.length
    rest.splice(insert, 0, ...block)

    // mirror the splices on the line indexes so every node — moved
    // block included — is re-attached to exactly the line it came from
    const origin = lines.map((_, i) => i)
    const moved = origin.splice(drag.line, block.length)
    origin.splice(insert, 0, ...moved)
    const map = new Map(origin.map((oldLine, newLine) => [newLine, oldLine]))

    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)
    // reselect the moved block at its new position
    selectByLine(insert)
  }

  return {
    elements,
    bodyElement,
    selectedElement,
    draggingId,
    dropTarget,
    getElement,
    elementAtLine,
    updateElement,
    changeElementType,
    setElementArg,
    removeElement,
    copyElementBlock,
    pasteElementBlock,
    insertElementBlock,
    selectElement,
    selectByLine,
    reorderElement,
    editorFocusTick,
    requestEditorFocus,
  }
}
