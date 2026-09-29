<script setup lang="ts">
// The Layers column: the element tree of whatever the canvas is showing, and
// the surface structure is authored on.
//
// It replaces the code editor. The DSL only ever carried an element's type,
// nesting, ref, binding and link — everything else (classes, content, media,
// interactions, translations) lives on the node and is edited in the panels —
// so this shows the same structure without the text round-trip.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { useElement, type DropPosition } from '@/composables/useElement'
import { usePage } from '@/composables/usePage'
import { useProject } from '@/composables/useProject'
import { useCollections } from '@/composables/useCollections'
import { useComponents } from '@/composables/useComponents'
import { useStructure } from '@/composables/useStructure'
import { useInsertDrag } from '@/composables/useInsertDrag'
import { usePanel } from '@/composables/usePanel'
import { useDrawerEscape } from '@/composables/useDrawerEscape'
import { validateDocument } from '@/lib/syntax'
import { findNode } from '@/lib/tree'
import LayerRow from './LayerRow.vue'
import { useLayerState } from './layerState'
import type { ElementNode } from '@/types/editor'

const { activePage } = usePage()
const { project } = useProject()
const { collections } = useCollections()
const { components } = useComponents()
const {
  selectedElement, selectedElementIds, selectElement, extendSelection,
  draggingId, dropTarget, getElement, elementAtLine,
} = useElement()
const { backend } = useStructure()
const { registerDropResolver } = useInsertDrag()
const { togglePanel } = usePanel()
const { reveal, isCollapsed, setCollapsed, toggle, editingRefId } = useLayerState()

const roots = computed(() => backend.value.roots.value)
const title = computed(() => activePage.value?.name ?? 'Layers')
const isPage = computed(() => backend.value.kind === 'page')

const panel = ref<HTMLElement>()
const scroller = ref<HTMLElement>()

// --- the visible rows, in order: what ↑/↓ walk and what a drag hit-tests ---

const visibleRows = computed<ElementNode[]>(() => {
  const out: ElementNode[] = []
  const walk = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      out.push(node)
      if (node.children.length && !isCollapsed(node.id)) walk(node.children)
    }
  }
  walk(roots.value)
  return out
})

/** ids from the root down to `id`, excluding it */
function ancestorsOf(id: string): string[] {
  const path: string[] = []
  const walk = (nodes: ElementNode[], trail: string[]): boolean => {
    for (const node of nodes) {
      if (node.id === id) {
        path.push(...trail)
        return true
      }
      if (walk(node.children, [...trail, node.id])) return true
    }
    return false
  }
  walk(roots.value, [])
  return path
}

// a selection made anywhere else — the canvas, a shortcut, the interactions
// panel's target picker — has to become visible here
watch(
  () => selectedElement.value?.id,
  async (id) => {
    if (!id || !findNode(roots.value, id)) return
    reveal(ancestorsOf(id))
    await new Promise(requestAnimationFrame)
    rowEl(id)?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)

const rowEl = (id: string) =>
  panel.value?.querySelector<HTMLElement>(`[data-layer-row="${CSS.escape(id)}"]`) ?? null

// --- drop resolution, shared by row drags and the ⌘E dock's insert drag ---

/**
 * Which row is under this pointer Y, and where in it: the top and bottom
 * quarters mean before/after, the middle means inside — but only for a node
 * that can actually take children, otherwise a drop on a leaf's middle would
 * silently become something else.
 */
function resolveAt(clientY: number): { id: string; position: DropPosition } | null {
  const box = scroller.value?.getBoundingClientRect()
  if (!box) return null
  const el = document
    .elementFromPoint(box.left + box.width / 2, clientY)
    ?.closest<HTMLElement>('[data-layer-row]')
  if (!el) return null
  const id = el.dataset.layerRow!
  const node = getElement(id)
  if (!node) return null
  const rect = el.getBoundingClientRect()
  const frac = (clientY - rect.top) / rect.height
  if (backend.value.isContainer(node)) {
    if (frac < 0.25) return { id, position: 'before' }
    if (frac > 0.75) return { id, position: 'after' }
    return { id, position: 'inside' }
  }
  return { id, position: frac < 0.5 ? 'before' : 'after' }
}

onMounted(() => registerDropResolver(resolveAt))
onBeforeUnmount(() => registerDropResolver(null))

// --- dragging a row to reorder or re-nest ---

const DRAG_THRESHOLD = 4

function onRowPointerDown(e: PointerEvent, id: string) {
  if (e.button !== 0 || editingRefId.value) return
  const node = getElement(id)
  if (!node || !backend.value.can(node, 'move')) return
  const start = { x: e.clientX, y: e.clientY }
  let active = false

  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= DRAG_THRESHOLD) return
      active = true
      // the shared refs: the canvas paints its own drop feedback off them, so
      // dragging in the tree highlights the element out there too
      draggingId.value = id
      document.body.style.cursor = 'grabbing'
    }
    const hit = resolveAt(ev.clientY)
    dropTarget.value =
      hit && hit.id !== id && backend.value.canDrop([id], hit.id, hit.position) ? hit : null
  }

  const end = () => {
    const target = dropTarget.value
    const dropped = active
    cleanup()
    if (dropped && target) backend.value.move([id], target.id, target.position)
  }

  const cancel = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.stopPropagation()
    cleanup()
  }

  function cleanup() {
    draggingId.value = null
    dropTarget.value = null
    document.body.style.cursor = ''
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('keydown', cancel, true)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('keydown', cancel, true)
}

// --- keyboard ---

function onKeydown(e: KeyboardEvent) {
  // a key typed into the inline ref field is that field's business — and it
  // fires here on the way up, AFTER the field has closed itself, so testing
  // `editingRefId` alone would let Enter immediately re-open what it just
  // committed
  if (editingRefId.value || e.target !== panel.value) return
  const current = selectedElement.value
  const rows = visibleRows.value
  const at = current ? rows.findIndex((n) => n.id === current.id) : -1

  // Shift+↑/↓ MOVES the element; ⌘⇧↑/↓ extends the selection; plain ↑/↓ walk
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const dir = e.key === 'ArrowUp' ? 'up' : 'down'
    if (e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (backend.value.nudge(dir)) e.preventDefault()
      return
    }
    if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
      extendSelection(dir)
      e.preventDefault()
      return
    }
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + (dir === 'up' ? -1 : 1)))]
    if (next) selectElement(next.id)
    e.preventDefault()
    return
  }

  if (!current) return

  if (e.key === 'ArrowRight') {
    if (current.children.length && isCollapsed(current.id)) setCollapsed(current.id, false)
    else if (current.children.length) selectElement(current.children[0]!.id)
    e.preventDefault()
    return
  }
  if (e.key === 'ArrowLeft') {
    if (current.children.length && !isCollapsed(current.id)) setCollapsed(current.id, true)
    else {
      const parent = ancestorsOf(current.id).slice(-1)[0]
      if (parent) selectElement(parent)
    }
    e.preventDefault()
    return
  }
  // the panels lost their keyboard entry point when the code editor's typed
  // '(' / '[' / '{' went away — these are it, scoped to the focused tree so
  // they can never fire while typing somewhere else
  const panelKey = { s: 'style', d: 'data', i: 'interactions' }[e.key.toLowerCase()]
  if (panelKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    togglePanel(panelKey)
    e.preventDefault()
    return
  }
  if (e.key === 'Enter' && isPage.value && backend.value.can(current, 'ref')) {
    editingRefId.value = current.id
    e.preventDefault()
  }
}

// --- issues: what the code editor's diagnostics gutter used to surface ---

const issues = computed(() => {
  const page = activePage.value
  if (!isPage.value || !page) return []
  const collectionNames = collections.value.map((c) => c.name)
  const listFieldNames = collections.value.flatMap((c) =>
    c.fields
      .filter((f) => f.type === 'multi-reference' || f.type === 'multi-image')
      .map((f) => f.name),
  )
  const dataOnly = collections.value
    .filter((c) => c.detailRoutes === false)
    .map((c) => c.name)
  return validateDocument(
    page.code,
    components.value.map((c) => c.name),
    collectionNames,
    listFieldNames,
    dataOnly,
  )
})

function goToIssue(line: number) {
  const node = elementAtLine(line)
  if (node) selectElement(node.id)
}

void project // keeps the issues list reactive to component/collection renames

useDrawerEscape(panel, {
  canPeel: () => !!editingRefId.value,
  peel: () => (editingRefId.value = null),
})
</script>

<template>
  <div
    ref="panel"
    data-insert-surface
    class="flex h-full flex-col bg-background outline-none"
    tabindex="0"
    @keydown="onKeydown"
  >
    <!-- h-11 matches the other columns' header, so switching between them
         moves nothing below it -->
    <div class="flex h-11 shrink-0 items-center gap-1 px-2.5">
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ title }}</span>
    </div>

    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto px-1 pb-8">
      <LayerRow
        v-for="node in roots"
        :key="node.id"
        :node="node"
        :depth="0"
        @row-pointerdown="onRowPointerDown"
      />
      <p v-if="!roots.length" class="px-2 py-6 text-center text-xs text-muted-foreground">
        Nothing here yet.
      </p>
    </div>

    <!-- diagnostics used to live in the code editor's gutter; without it they
         would reach nobody, and they still arrive from agents and merges -->
    <div v-if="issues.length" class="shrink-0 border-t border-input">
      <div class="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[9px] font-medium tracking-wide text-pending uppercase">
        <TriangleAlert class="size-3" />
        {{ issues.length }} {{ issues.length === 1 ? 'issue' : 'issues' }}
      </div>
      <div class="max-h-28 overflow-y-auto pb-1.5">
        <button
          v-for="issue in issues"
          :key="`${issue.line}:${issue.message}`"
          type="button"
          class="flex w-full items-start gap-1 px-2.5 py-1 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent/20 hover:text-foreground"
          @click="goToIssue(issue.line)"
        >
          {{ issue.message }}
        </button>
      </div>
    </div>
  </div>
</template>
