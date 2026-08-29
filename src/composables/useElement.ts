import { computed, ref } from 'vue'
import { usePage } from './usePage'
import { hasOpenArgBracket, interactionMarkerOf, reconcile, styleMarkerOf, withInteractionMarker, withStyleMarker } from '@/lib/syntax'
import { isKnownElement } from '@/lib/elements'
import { isComponentType } from '@/lib/components'
import { deepClone, findNode, walkNodes } from '@/lib/tree'
import type { ConditionSpec, ElementNode, InteractionBinding } from '@/types/editor'

/** per-node settings captured alongside a copied code block, DFS order */
interface NodeProps {
  /** the source node's id, so interaction targetIds can be remapped on paste */
  id?: string
  classes?: string
  content?: string
  htmlId?: string
  src?: string
  link?: string
  locales?: ElementNode['locales']
  interactions?: InteractionBinding[]
  conditions?: ConditionSpec
}

/** a copied element: its dedented code lines + every node's settings */
export interface ElementBlock {
  code: string[]
  props: NodeProps[]
}

/** snapshot a node's non-code settings; DFS order pairs with paste's created set */
function captureProps(n: ElementNode): NodeProps {
  return {
    id: n.id,
    classes: n.classes,
    content: n.content,
    htmlId: n.htmlId,
    src: n.src,
    link: n.link,
    locales: n.locales ? deepClone(n.locales) : undefined,
    interactions: n.interactions ? deepClone(n.interactions) : undefined,
    conditions: n.conditions ? deepClone(n.conditions) : undefined,
  }
}

const selectedElementId = ref<string | null>(null)

// the fixed end of a multi-selection; the focus (selectedElementId) moves with
// Cmd+Shift+↑/↓. Together they define a contiguous run of siblings.
const selectionAnchorId = ref<string | null>(null)

// a transient "preview" highlight, independent of selection — e.g. hovering an
// interaction's Target button outlines the target on the canvas + code editor
// without changing the real selection (which would swap the settings panel)
const highlightedElementId = ref<string | null>(null)

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
   * Sets or clears an element token's […] argument — field binding or
   * collection name — by patching the code line in place.
   */
  function setElementArg(id: string, arg: string | null) {
    const page = activePage.value
    const node = page ? findNode(page.elements, id) : null
    if (!page || !node || node.line === undefined) return
    const lines = page.code.split('\n')
    const line = lines[node.line]!
    // close-bracket optional so a write mid arg-edit replaces the unclosed
    // '[' instead of inserting a second bracket (':h1[:' → ':h1[title]:')
    const pattern = new RegExp(`(:${node.type})(\\[[a-z0-9.-]*\\]?)?`)
    lines[node.line] = line.replace(pattern, arg ? `$1[${arg}]` : '$1')
    page.code = lines.join('\n')
    node.arg = arg || undefined
  }

  /**
   * Keeps each element line's markers in step with the node: '(+)' present
   * iff it has classes, '{+}' iff it has interactions. Markers are derived
   * state — deleting one by hand doesn't clear anything, it just gets
   * re-added here. Lines holding an incomplete marker or an unclosed '['
   * are left alone (that's an open panel session, finalized by the code
   * editor), and component instance subtrees are skipped — their styles and
   * interactions live on the master. Structure is unchanged, so no
   * reconcile (same pattern as setElementArg).
   */
  function syncNodeMarkers() {
    const page = activePage.value
    if (!page) return
    const lines = page.code.split('\n')
    let changed = false
    const visit = (nodes: ElementNode[]) => {
      for (const node of nodes) {
        if (node.type !== 'body' && node.line !== undefined && lines[node.line] !== undefined) {
          let line = lines[node.line]!
          // an unclosed '[' is an arg edit in progress — the marker heads
          // can't anchor past it, so a write would land mid-token; skip
          if (!hasOpenArgBracket(line)) {
            const style = styleMarkerOf(line)
            if (style === undefined || style === '(+)') {
              const want = !!node.classes?.trim()
              if (want !== (style === '(+)')) line = withStyleMarker(line, want)
            }
            const inter = interactionMarkerOf(line)
            if (inter === undefined || inter === '{+}') {
              const want = !!node.interactions?.length
              if (want !== (inter === '{+}')) line = withInteractionMarker(line, want)
            }
            if (line !== lines[node.line]) {
              lines[node.line] = line
              changed = true
            }
          }
        }
        if (!isComponentType(node.type)) visit(node.children)
      }
    }
    visit(page.elements)
    if (changed) page.code = lines.join('\n')
  }

  /**
   * Sets or clears an element's link — the code-owned '@target' suffix — by
   * patching the token line in place. '@item' serializes as '@item' (the
   * current-entry sentinel); any other value is written verbatim.
   */
  function setElementLink(id: string, link: string | null) {
    const page = activePage.value
    const node = page ? findNode(page.elements, id) : null
    if (!page || !node || node.line === undefined) return
    const lines = page.code.split('\n')
    const target = link === '@item' ? 'item' : link
    // one token per line → any existing '@…' suffix runs to end of line
    const base = lines[node.line]!.replace(/@\S+$/, '')
    lines[node.line] = target ? `${base}@${target}` : base
    page.code = lines.join('\n')
    node.link = link || undefined
  }

  /** deletes an element's whole code block (code is the structural source) */
  function removeElement(id: string) {
    const page = activePage.value
    if (!page) return
    const node = findNode(page.elements, id)
    if (!node || node.line === undefined || node.type === 'body') return
    // the element just above the one being removed — becomes the new selection
    // (its preceding sibling, or its parent when it was the first child) so the
    // selection doesn't fall back to the whole body
    const prevLine = node.line - 1
    const length = (node.endLine ?? node.line) - node.line + 1
    const rest = page.code.split('\n')
    rest.splice(node.line, length)
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) map.set(i, i < node.line ? i : i + length)
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)
    if (selectedElementId.value === id) {
      selectedElementId.value = (prevLine >= 0 ? elementAtLine(prevLine) : null)?.id ?? null
    }
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
    walkNodes([node], (n) => props.push(captureProps(n)))
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

    // every node in the inserted line range, DFS/line order — matches the
    // (possibly multi-root) props capture order. Track the first and last
    // top-level sibling so the whole pasted run becomes the selection.
    const blockEnd = insertAt + blockLines.length
    const created: ElementNode[] = []
    let firstRootId: string | null = null
    let lastRootId: string | null = null
    walkNodes(page.elements, (n) => {
      if (n.line === undefined || n.line < insertAt || n.line >= blockEnd) return
      created.push(n)
      if (n.line === insertAt && firstRootId === null) firstRootId = n.id
      // pre-order visits a parent before its children, so the first node that
      // ends on the block's last line is the shallowest (the last sibling)
      if ((n.endLine ?? n.line) === blockEnd - 1 && lastRootId === null) lastRootId = n.id
    })
    if (created.length) {
      // source id → pasted id, so an interaction targeting another node inside
      // the copied block retargets to that node's copy (not the original)
      const idMap = new Map<string, string>()
      block.props.forEach((p, i) => {
        if (p.id && created[i]) idMap.set(p.id, created[i]!.id)
      })
      block.props.forEach((p, i) => {
        const n = created[i]
        if (!n) return
        if (p.classes) n.classes = p.classes
        if (p.content) n.content = p.content
        if (p.htmlId) n.htmlId = p.htmlId
        if (p.src) n.src = p.src
        if (p.link) n.link = p.link
        if (p.locales) n.locales = deepClone(p.locales)
        if (p.interactions) {
          n.interactions = p.interactions.map((x) => ({
            ...x,
            id: crypto.randomUUID(),
            // internal target → its copy; external target or null → unchanged
            targetId: x.targetId ? (idMap.get(x.targetId) ?? x.targetId) : null,
          }))
        }
        if (p.conditions) {
          const spec = deepClone(p.conditions) as ConditionSpec
          for (const rule of spec.rules) rule.id = crypto.randomUUID()
          n.conditions = spec
        }
      })
      selectionAnchorId.value = firstRootId ?? lastRootId
      selectedElementId.value = lastRootId ?? firstRootId
    }
    return firstRootId ? findNode(page.elements, firstRootId) : null
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
    selectionAnchorId.value = id // a plain select collapses any multi-selection
  }

  const highlightedElement = computed(() =>
    highlightedElementId.value ? findNode(elements.value, highlightedElementId.value) : null,
  )

  function highlightElement(id: string | null) {
    highlightedElementId.value = id
  }

  /** ask the code editor to move focus + caret onto the selection's line */
  function requestEditorFocus() {
    editorFocusTick.value++
  }

  function selectByLine(line: number) {
    const id = elementAtLine(line)?.id ?? null
    // caret landing inside the current multi-selection keeps it (else the
    // keyup that follows an extend/move would collapse it back to one)
    if (id && selectedElementIds.value.includes(id)) return
    selectElement(id)
  }

  // --- multi-selection: a contiguous run of siblings (anchor..focus) ---

  /** the sibling list (children array) holding `id`, and its index within it */
  function siblingsOf(id: string): { list: ElementNode[]; index: number } | null {
    let found: { list: ElementNode[]; index: number } | null = null
    const visit = (list: ElementNode[]) => {
      if (found) return
      const index = list.findIndex((n) => n.id === id)
      if (index !== -1) {
        found = { list, index }
        return
      }
      for (const n of list) visit(n.children)
    }
    visit(elements.value)
    return found
  }

  /** contiguous sibling ids from the anchor to the focus (selectedElementId) */
  const selectedElementIds = computed<string[]>(() => {
    const focus = selectedElementId.value
    if (!focus) return []
    const anchor = selectionAnchorId.value ?? focus
    if (anchor === focus) return [focus]
    const f = siblingsOf(focus)
    const a = siblingsOf(anchor)
    if (!f || !a || f.list !== a.list) return [focus] // not siblings → just the focus
    const lo = Math.min(f.index, a.index)
    const hi = Math.max(f.index, a.index)
    return f.list.slice(lo, hi + 1).map((n) => n.id)
  })

  const isMultiSelect = computed(() => selectedElementIds.value.length > 1)

  /** grow/shrink the selection to the previous/next sibling of the focus */
  function extendSelection(dir: 'up' | 'down') {
    const focus = selectedElementId.value
    if (!focus) return
    const f = siblingsOf(focus)
    if (!f) return
    const next = f.list[f.index + (dir === 'down' ? 1 : -1)]
    if (!next || next.type === 'body') return
    if (!selectionAnchorId.value) selectionAnchorId.value = focus
    selectedElementId.value = next.id // focus moves; anchor stays → range recomputes
  }

  /** deletes a contiguous run of sibling blocks in one splice */
  function removeElements(ids: string[]) {
    const page = activePage.value
    if (!page) return
    const nodes = ids
      .map((id) => findNode(page.elements, id))
      .filter((n): n is ElementNode => !!n && n.line !== undefined && n.type !== 'body')
    if (nodes.length <= 1) return removeElement(nodes[0]?.id ?? ids[0]!)
    const startLine = Math.min(...nodes.map((n) => n.line!))
    const endLine = Math.max(...nodes.map((n) => n.endLine ?? n.line!))
    const prevLine = startLine - 1
    const length = endLine - startLine + 1
    const rest = page.code.split('\n')
    rest.splice(startLine, length)
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) map.set(i, i < startLine ? i : i + length)
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)
    selectedElementId.value = (prevLine >= 0 ? elementAtLine(prevLine) : null)?.id ?? null
    selectionAnchorId.value = selectedElementId.value
  }

  /** copies a contiguous run of siblings as one multi-root block */
  function copyElementsBlock(ids: string[]): ElementBlock | null {
    const page = activePage.value
    if (!page) return null
    const nodes = ids
      .map((id) => findNode(page.elements, id))
      .filter((n): n is ElementNode => !!n && n.line !== undefined && n.type !== 'body')
      .sort((a, b) => a.line! - b.line!)
    if (nodes.length <= 1) return copyElementBlock(nodes[0]?.id ?? ids[0]!)
    const startLine = nodes[0]!.line!
    const endLine = Math.max(...nodes.map((n) => n.endLine ?? n.line!))
    const raw = page.code.split('\n').slice(startLine, endLine + 1)
    const depth = raw[0]!.match(/^\t*/)![0].length
    const code = raw.map((l) => l.replace(new RegExp(`^\\t{0,${depth}}`), ''))
    const props: NodeProps[] = []
    walkNodes(nodes, (n) => props.push(captureProps(n)))
    return { code, props }
  }

  /**
   * Moves the source line range [start,end] before/after/inside a target,
   * re-indenting to the destination depth and reparsing. Returns the new insert
   * line, or null when the move is invalid. The single- and multi-element moves
   * both go through here.
   */
  function reorderBlock(
    start: number,
    end: number,
    targetId: string,
    position: DropPosition,
  ): number | null {
    const page = activePage.value
    if (!page) return null
    const target = findNode(page.elements, targetId)
    if (!target || target.line === undefined) return null
    // the body wrap can only receive children ('inside')
    if (target.type === 'body' && position !== 'inside') return null
    const targetEnd = target.endLine ?? target.line
    // can't drop into your own range (covers dropping inside a descendant)
    if (target.line >= start && targetEnd <= end) return null
    // 'inside' only makes sense for a block (has a distinct close line)
    if (position === 'inside' && targetEnd <= target.line) return null

    const lines = page.code.split('\n')
    const indentOf = (s: string) => s.match(/^\t*/)![0].length
    // inside → sit one level under the target; before/after → match it
    const destIndent = indentOf(lines[target.line]!) + (position === 'inside' ? 1 : 0)
    const delta = destIndent - indentOf(lines[start]!)

    const block = lines
      .slice(start, end + 1)
      .map((l) =>
        delta >= 0 ? '\t'.repeat(delta) + l : l.replace(new RegExp(`^\\t{0,${-delta}}`), ''),
      )

    const rest = [...lines]
    rest.splice(start, block.length)
    // before → target's open line; inside → its close line (last child);
    // after → just past its close line
    let insert =
      position === 'before' ? target.line : position === 'inside' ? targetEnd : targetEnd + 1
    if (end < insert) insert -= block.length
    rest.splice(insert, 0, ...block)

    // mirror the splices on the line indexes so every node — moved block
    // included — is re-attached to exactly the line it came from
    const origin = lines.map((_, i) => i)
    const moved = origin.splice(start, block.length)
    origin.splice(insert, 0, ...moved)
    const map = new Map(origin.map((oldLine, newLine) => [newLine, oldLine]))

    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)
    return insert
  }

  /** moves one element's block before/after/inside a target, then reselects it */
  function reorderElement(dragId: string, targetId: string, position: DropPosition) {
    const page = activePage.value
    if (!page || dragId === targetId) return
    const drag = findNode(page.elements, dragId)
    if (!drag || drag.line === undefined || drag.type === 'body') return
    const insert = reorderBlock(drag.line, drag.endLine ?? drag.line, targetId, position)
    if (insert !== null) selectByLine(insert)
  }

  /**
   * Moves the whole multi-selection up/down one slot as a unit — same
   * descend-into-block / escape-to-parent / swap-with-sibling behaviour as the
   * single-element move (mirrors moveSelected in CodeEditor). Selection preserved.
   */
  function moveSelectionGroup(dir: 'up' | 'down'): boolean {
    const ids = selectedElementIds.value
    if (ids.length < 2) return false
    const anchor = selectionAnchorId.value
    const focus = selectedElementId.value
    const first = findNode(elements.value, ids[0]!)
    const last = findNode(elements.value, ids[ids.length - 1]!)
    if (!first || !last || first.line === undefined || last.line === undefined) return false
    const start = first.line
    const end = last.endLine ?? last.line

    let targetId: string
    let position: DropPosition
    if (dir === 'up') {
      const p = elementAtLine(start - 1)
      if (!p || p.type === 'body' || p.line === undefined) return false
      // a preceding sibling *block* (its close line sits just above the group)
      const intoBlock =
        (p.endLine ?? p.line) === start - 1 && p.line < start - 1 && !isComponentType(p.type)
      if (intoBlock && p.children.length) {
        targetId = p.children[p.children.length - 1]!.id // descend as its last child
        position = 'after'
      } else if (intoBlock) {
        targetId = p.id // empty block → straight inside
        position = 'inside'
      } else {
        targetId = p.id // leaf sibling (swap) or parent open line (escape)
        position = 'before'
      }
    } else {
      const n = elementAtLine(end + 1)
      if (!n || n.type === 'body' || n.line === undefined) return false
      // a following sibling *block* (its open line sits just below the group)
      const intoBlock = n.line === end + 1 && (n.endLine ?? n.line) > n.line && !isComponentType(n.type)
      if (intoBlock && n.children.length) {
        targetId = n.children[0]!.id // descend as its first child
        position = 'before'
      } else if (intoBlock) {
        targetId = n.id // empty block → straight inside
        position = 'inside'
      } else {
        targetId = n.id // leaf sibling (swap) or parent close line (escape)
        position = 'after'
      }
    }

    const insert = reorderBlock(start, end, targetId, position)
    if (insert === null) return false
    selectionAnchorId.value = anchor
    selectedElementId.value = focus
    return true
  }

  /**
   * Wraps the current selection (a single element or a contiguous run of
   * siblings) in a new :div block. Splices the code — open line above, the
   * selected lines indented one deeper, close line below — then reconciles
   * with an explicit map so the wrapped nodes keep their identity (classes,
   * interactions, content survive). Selects the new div.
   */
  function wrapSelectionInDiv(): boolean {
    const page = activePage.value
    const ids = selectedElementIds.value
    if (!page || !ids.length) return false
    const first = findNode(page.elements, ids[0]!)
    const last = findNode(page.elements, ids[ids.length - 1]!)
    if (!first || !last || first.type === 'body' || first.line === undefined) return false
    if (last.line === undefined) return false
    const start = first.line
    const end = last.endLine ?? last.line

    // wrap the block: :div open, inner lines one level deeper, div: close
    const lines = page.code.split('\n')
    const indent = lines[start]!.match(/^\t*/)![0]
    const rest = [
      ...lines.slice(0, start),
      `${indent}:div`,
      ...lines.slice(start, end + 1).map((l) => `\t${l}`),
      `${indent}div:`,
      ...lines.slice(end + 1),
    ]
    // exact line map: open + close lines are new; inner lines shift down one,
    // everything after the close shifts down two
    const map = new Map<number, number>()
    for (let i = 0; i < rest.length; i++) {
      if (i < start) map.set(i, i)
      else if (i >= start + 1 && i <= end + 1) map.set(i, i - 1)
      else if (i > end + 2) map.set(i, i - 2)
    }
    const before = page.code
    page.code = rest.join('\n')
    page.elements = reconcile(before, page.code, page.elements, map)

    // select the new div (single selection — the group is now one element)
    let created: ElementNode | null = null
    walkNodes(page.elements, (n) => {
      if (n.line === start && n.type === 'div' && !created) created = n
    })
    if (created) selectElement((created as ElementNode).id)
    return true
  }

  return {
    elements,
    bodyElement,
    selectedElement,
    selectedElementIds,
    isMultiSelect,
    extendSelection,
    draggingId,
    dropTarget,
    getElement,
    elementAtLine,
    updateElement,
    changeElementType,
    setElementArg,
    setElementLink,
    syncNodeMarkers,
    removeElement,
    removeElements,
    copyElementBlock,
    copyElementsBlock,
    pasteElementBlock,
    insertElementBlock,
    selectElement,
    selectByLine,
    reorderElement,
    moveSelectionGroup,
    wrapSelectionInDiv,
    highlightedElement,
    highlightElement,
    editorFocusTick,
    requestEditorFocus,
  }
}
