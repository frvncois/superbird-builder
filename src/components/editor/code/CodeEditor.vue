<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePage } from '@/composables/usePage'
import { useElement, type DropPosition } from '@/composables/useElement'
import { useContextMenu } from '@/composables/useContextMenu'
import { usePanel } from '@/composables/usePanel'
import { usePersistence } from '@/composables/usePersistence'
import { useComponents } from '@/composables/useComponents'
import { useInsertDrag } from '@/composables/useInsertDrag'
import { expandComponentInstances, isComponentType } from '@/lib/components'
import { isKnownElement } from '@/lib/elements'
import { useCollections } from '@/composables/useCollections'
import { CircleAlert, CircleCheck, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { closeArgBracket, hasOpenArgBracket, interactionMarkerOf, reconcile, styleMarkerOf, suggestCompletion, validateDocument, withInteractionMarker, withStyleMarker, OPEN, CLOSE } from '@/lib/syntax'
import { enforceDocument, parseSetup, replaceSetup, setSetupLocale, slugify } from '@/lib/document'
import { useLocale } from '@/composables/useLocale'
import { collapseCode, computeFold, expandCode, type FoldRange } from '@/lib/folding'
import { reducedMotion, slideGhost, styleGhostBase, type GhostRect } from '@/lib/flip'
import { walkNodes } from '@/lib/tree'
import type { ElementNode } from '@/types/editor'

const LINE_HEIGHT = 20 // leading-5
// vertical padding above the first line — keep in sync with the padding
// class shared by the gutter, textarea and overlays (currently px-2 → 0)
const PAD_Y = 0

const { activePage, pages } = usePage()
const { selectedElement, selectedElementIds, isMultiSelect, extendSelection, moveSelectionGroup, selectByLine, selectElement, elementAtLine, getElement, draggingId, dropTarget, reorderElement, highlightedElement, editorFocusTick, syncNodeMarkers } =
  useElement()

const {
  openMenu,
  copySelection,
  cutSelection,
  pasteOnSelection,
  duplicateSelection,
  wrapSelection,
  copiedBlock,
  clipboardIsElement,
} = useContextMenu()
const { undo, redo } = usePersistence()
const { activePanelId, openPanel } = usePanel()
const { components, masterFor } = useComponents()
const componentNames = computed(() => components.value.map((c) => c.name))
const { registerCodeResolver } = useInsertDrag()
const { collections, activeCollection, activeEntry, entryPath } = useCollections()
const { activeLocale, locales, defaultLocale, setActiveLocale } = useLocale()
const collectionNames = computed(() => collections.value.map((c) => c.name))
// multi-reference field names are also valid :collection-list sources
const listFieldNames = computed(() =>
  collections.value.flatMap((c) =>
    c.fields.filter((f) => f.type === 'multi-reference').map((f) => f.name),
  ),
)
// page paths for '@' link autocomplete (templates aren't linkable targets)
const pagePaths = computed(() =>
  pages.value.filter((p) => !p.collectionId).map((p) => p.path),
)

/** while an entry is loaded, the @setup shows that entry's name + path */
const entrySetup = computed(() =>
  activeEntry.value && activeCollection.value
    ? {
        name: activeEntry.value.name,
        slug: entryPath(activeCollection.value, activeEntry.value),
        status: activePage.value.status,
        locale: defaultLocale.value,
      }
    : null,
)

const COMPONENT_TOKEN = /^(?::[A-Z][a-zA-Z0-9-]*:?|[A-Z][a-zA-Z0-9-]*:)$/

// --- code folding ---
// Ids of block open-nodes whose bodies are collapsed. Everything below
// stays inert (identity maps) while this set is empty, so the editor is
// byte-for-byte unchanged when nothing is folded.
const foldedIds = ref(new Set<string>())

/** the full, unfolded source (with the entry-setup overlay applied and
 * the runtime active locale substituted onto the setup line) */
const rawSource = computed(() => {
  const base = entrySetup.value
    ? replaceSetup(activePage.value.code, entrySetup.value)
    : activePage.value.code
  return setSetupLocale(base, activeLocale.value)
})

/** real line ranges hidden by active folds, from the parsed tree */
const foldRanges = computed<FoldRange[]>(() => {
  if (!foldedIds.value.size) return []
  const ranges: FoldRange[] = []
  walkNodes(activePage.value.elements, (n) => {
    if (
      foldedIds.value.has(n.id) &&
      n.line !== undefined &&
      n.endLine !== undefined &&
      n.endLine > n.line
    ) {
      ranges.push({ start: n.line, end: n.endLine })
    }
  })
  return ranges
})

const foldInfo = computed(() => computeFold(rawSource.value, foldRanges.value))

/** display line → real line */
function d2r(display: number): number {
  return foldInfo.value.displayToReal[display] ?? display
}
/** real line → display line (nearest visible line above when hidden) */
function r2d(real: number): number {
  const map = foldInfo.value.realToDisplay
  for (let i = real; i >= 0; i--) if ((map[i] ?? -1) >= 0) return map[i]!
  return 0
}

/** real line → the foldable block node opening there (endLine > line) */
const foldableAt = computed(() => {
  const map = new Map<number, string>()
  walkNodes(activePage.value.elements, (n) => {
    if (n.line !== undefined && n.endLine !== undefined && n.endLine > n.line) map.set(n.line, n.id)
  })
  return map
})

function foldableAtDisplay(displayLine: number): string | undefined {
  return foldableAt.value.get(d2r(displayLine))
}

function isFolded(displayLine: number): boolean {
  const id = foldableAtDisplay(displayLine)
  return !!id && foldedIds.value.has(id)
}

function toggleFold(displayLine: number) {
  const id = foldableAtDisplay(displayLine)
  if (!id) return
  const next = new Set(foldedIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  foldedIds.value = next
}

/** reveals any folds hiding a real line (used before jumping to it) */
function unfoldAt(real: number) {
  if (!foldedIds.value.size) return
  const next = new Set(foldedIds.value)
  walkNodes(activePage.value.elements, (n) => {
    if (
      next.has(n.id) &&
      n.line !== undefined &&
      n.endLine !== undefined &&
      real > n.line &&
      real <= n.endLine
    ) {
      next.delete(n.id)
    }
  })
  foldedIds.value = next
}

/** writes full code back to the page / loaded entry (fold-independent) */
function store(full: string) {
  const page = activePage.value
  const typed = parseSetup(full)
  // a hand-typed locale value switches the editor when it names a known
  // locale; unknown values are discarded (the display re-substitutes).
  // The STORED line is always pinned to the default locale so branch
  // merges never see pages differ by editing locale alone.
  if (typed.locale !== activeLocale.value && locales.value.includes(typed.locale)) {
    setActiveLocale(typed.locale)
  }
  full = setSetupLocale(full, defaultLocale.value)
  if (entrySetup.value && activeCollection.value && activeEntry.value) {
    // @setup edits route to the loaded entry; the template keeps its own setup
    activeEntry.value.name = typed.name
    const prefix = `/${activeCollection.value.name}/`
    const rest = typed.slug.startsWith(prefix)
      ? typed.slug.slice(prefix.length)
      : (typed.slug.replace(/^\/+/, '').split('/').pop() ?? '')
    activeEntry.value.slug = slugify(rest)
    const stored = replaceSetup(full, {
      name: page.name,
      slug: page.path,
      status: page.status,
      locale: defaultLocale.value,
    })
    page.elements = reconcile(page.code, stored, page.elements)
    page.code = stored
    return
  }
  page.name = typed.name
  page.path = typed.slug
  page.status = typed.status
  page.elements = reconcile(page.code, full, page.elements)
  page.code = full
}

/** right-click on an element's code line opens its context menu */
function onContextMenu(e: MouseEvent) {
  const el = input.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const line = Math.max(0, Math.floor((e.clientY - rect.top + el.scrollTop - PAD_Y) / LINE_HEIGHT))
  const node = elementAtLine(d2r(line))
  if (!node) return // setup/scaffold lines keep the native menu
  openMenu(e, node.id)
}

// The textarea edits the folded VIEW; storage always works on full code.
const code = computed({
  get: () => collapseCode(rawSource.value, foldRanges.value),
  set: (value: string) => store(expandCode(rawSource.value, foldRanges.value, value)),
})

// --- status mini-dropdown: a caret on the @setup status line ---

const PAGE_STATUSES = ['draft', 'published']
const statusOpen = ref(false)
const statusRef = ref<HTMLElement>()

const statusLine = computed(() => {
  const lines = code.value.split('\n')
  const idx = lines.findIndex((l) => /^\s*status:/.test(l))
  return idx === -1 ? null : { line: idx, text: lines[idx]! }
})

function setStatus(status: string) {
  statusOpen.value = false
  const page = activePage.value
  if (page.status === status) return
  page.status = status
  // same canonical line count, only the status value changes — node
  // lines are untouched, so no reconcile is needed
  page.code = replaceSetup(page.code, {
    name: page.name,
    slug: page.path,
    status,
    locale: defaultLocale.value,
  })
}

// the active locale is chosen from the app header now; the code editor's setup
// line just reflects it (via rawSource's setSetupLocale substitution)

function onSetupMenuClickOutside(e: MouseEvent) {
  if (statusOpen.value && statusRef.value && !statusRef.value.contains(e.target as Node)) {
    statusOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onSetupMenuClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onSetupMenuClickOutside))

/**
 * ⌘C/⌘X/⌘V/⌘D on the selected element while editing code. With text
 * highlighted the native clipboard wins (copy/cut/paste that text); with a
 * bare caret the copy/cut act on the element block. ⌘V pastes the element
 * only when the last copy was an element — otherwise native text paste. ⌘D
 * always duplicates (no native text meaning). Returns true when handled.
 */
function handleClipboardKey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false
  const el = input.value
  if (!el) return false
  const hasText = el.selectionStart !== el.selectionEnd
  switch (e.key.toLowerCase()) {
    case 'c':
      if (hasText) return (clipboardIsElement.value = false), false // native copy
      copySelection()
      e.preventDefault()
      return true
    case 'x':
      if (hasText) return (clipboardIsElement.value = false), false // native cut
      cutSelection()
      e.preventDefault()
      syncCaretToSelected() // follow the caret to the element above, not the body
      return true
    case 'v':
      if (!clipboardIsElement.value || !copiedBlock.value) return false // native paste
      pasteOnSelection()
      e.preventDefault()
      syncCaretToSelected() // keep the pasted block selected, not the body
      return true
    case 'd':
      duplicateSelection()
      e.preventDefault()
      syncCaretToSelected() // keep the duplicate selected, not the body
      return true
  }
  return false
}

/** ⌘Z / ⌘⇧Z drive the project undo history while the code editor is focused —
 * the global keymap skips text fields, and the textarea's native undo is
 * meaningless here since we rewrite its value on every edit. */
function handleHistoryKey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return false
  e.preventDefault()
  e.shiftKey ? redo() : undo()
  return true
}

// ⌘C/⌘X/⌘V/⌘D, ⌘G and ⌘Z; the element panels open by typing '(' / '[' / '{' on a token
function onShortcutKeydown(e: KeyboardEvent): boolean {
  if (handleClipboardKey(e)) return true
  if (handleHistoryKey(e)) return true
  // ⌘G wraps the selection in a div (handled here, not the global keymap, so
  // the caret follows the new div instead of trackCursor reselecting the body)
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
    wrapSelection()
    e.preventDefault()
    syncCaretToSelected()
    return true
  }
  // ⌘/Ctrl+Shift+↑/↓ extends the selection across siblings (multi-select)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    extendSelection(e.key === 'ArrowUp' ? 'up' : 'down')
    syncCaretToSelected()
    return true
  }
  return false
}

const lineCount = computed(() => code.value.split('\n').length)

const gutter = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
const textLayer = ref<HTMLElement>()
const scroll = ref({ top: 0, left: 0 })

// --- reorder ghost: the moved block's rows slide to their new spot so a
// reorder is visible even among many identical elements ---

const SLIDE_MS = 360
let activeGhostCancel: (() => void) | null = null
// display-line range hidden while the ghost slides into it, so the block isn't
// seen in two places at once
const slidingRange = ref<{ start: number; end: number } | null>(null)
let slidingClearTimer: ReturnType<typeof setTimeout> | null = null
// eases the selection highlight to its new range, but only during a reorder
// (a transition on every click would feel laggy)
const highlightEase = ref(false)
let highlightEaseTimer: ReturnType<typeof setTimeout> | null = null
function flashHighlightEase() {
  highlightEase.value = true
  if (highlightEaseTimer) clearTimeout(highlightEaseTimer)
  highlightEaseTimer = setTimeout(() => (highlightEase.value = false), SLIDE_MS + 60)
}

// --- Shift-hold "lift": while Shift is held in the (focused) editor, the
// selected element scales up a hair as a "picked up" affordance. Engages only
// after a short hold so quick Shift taps for capital letters don't blip it. ---

const shiftLifted = ref(false)
let shiftTimer: ReturnType<typeof setTimeout> | null = null
function clearLift() {
  if (shiftTimer) {
    clearTimeout(shiftTimer)
    shiftTimer = null
  }
  shiftLifted.value = false
}
function onShiftKeydown(e: KeyboardEvent) {
  if (e.key !== 'Shift' || e.repeat || shiftTimer || shiftLifted.value) return
  if (document.activeElement !== input.value || reducedMotion()) return
  const sel = selectedElement.value
  if (!sel || sel.type === 'body' || sel.line === undefined) return // nothing liftable
  shiftTimer = setTimeout(() => {
    shiftLifted.value = true
    shiftTimer = null
  }, 120)
}
function onShiftKeyup(e: KeyboardEvent) {
  if (e.key === 'Shift') clearLift()
}

// keeps the moved element lifted through its whole slide even if Shift is
// released mid-flight — otherwise the real rows snap to scale 1 while the ghost
// (cloned at 1.06) is still sliding, so the hand-off jumps
const liftedSlide = ref(false)
let liftedSlideTimer: ReturnType<typeof setTimeout> | null = null

/** the selected element is a real (non-body) element that is currently lifted */
const lifted = computed(() => {
  const sel = selectedElement.value
  if (!sel || sel.type === 'body' || sel.line === undefined) return false
  // an open Style/Data/Interactions panel keeps the edited element lifted;
  // single-selection only (a multi-selection can't be edited in a panel)
  const panelLift =
    !isMultiSelect.value && ['style', 'data', 'interactions'].includes(activePanelId.value ?? '')
  return shiftLifted.value || liftedSlide.value || panelLift
})

/** row `i` (display index) is within the lifted element's range */
function isLifted(i: number): boolean {
  return lifted.value && i >= highlight.value.start && i <= highlight.value.end
}

/** per-row transform (lift) + opacity (hidden while a ghost slides into it) */
function rowStyle(i: number) {
  const hidden = slidingRange.value && i >= slidingRange.value.start && i <= slidingRange.value.end
  return {
    // scale from the left edge: the row div is full-width but its text is
    // left-aligned, so a center origin would drift the code left on X while
    // lifting/settling. Anchoring left keeps the indent fixed — pure size lift.
    transform: isLifted(i) ? 'scale(1.06)' : undefined,
    transformOrigin: 'left center',
    transition: 'transform 150ms ease-out',
    opacity: hidden ? '0' : undefined,
  }
}

onMounted(() => {
  window.addEventListener('keydown', onShiftKeydown)
  window.addEventListener('keyup', onShiftKeyup)
  window.addEventListener('blur', clearLift)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShiftKeydown)
  window.removeEventListener('keyup', onShiftKeyup)
  window.removeEventListener('blur', clearLift)
  if (shiftTimer) clearTimeout(shiftTimer)
  if (slidingClearTimer) clearTimeout(slidingClearTimer)
  if (liftedSlideTimer) clearTimeout(liftedSlideTimer)
})

/** Clone the moved block's on-screen rows into a floating ghost pinned at its
 * current position. Null when it can't/shouldn't animate. */
function captureBlockGhost(node: ElementNode): { ghost: HTMLElement; from: GhostRect } | null {
  const layer = textLayer.value
  if (!layer || reducedMotion() || node.line === undefined) return null
  const startD = r2d(node.line)
  const endRaw = foldInfo.value.realToDisplay[node.endLine ?? node.line] ?? -1
  const endD = endRaw >= startD ? endRaw : startD
  const rows = Array.from(layer.children).slice(startD, endD + 1) as HTMLElement[]
  if (!rows.length) return null

  const first = rows[0]!.getBoundingClientRect()
  const from: GhostRect = {
    top: first.top,
    left: first.left,
    width: layer.clientWidth || first.width,
    height: rows.length * LINE_HEIGHT,
  }
  const ghost = document.createElement('div')
  const cs = getComputedStyle(layer)
  Object.assign(ghost.style, {
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    tabSize: cs.tabSize,
    whiteSpace: 'pre',
    overflow: 'hidden',
  })
  for (const row of rows) {
    const c = row.cloneNode(true) as HTMLElement
    c.style.opacity = '1' // in case the source row is mid-hide from a prior slide
    ghost.appendChild(c)
  }
  styleGhostBase(ghost, from)
  return { ghost, from }
}

/** Capture the block, run the reorder, then slide the ghost to where the block
 * landed (its node identity is preserved across the reorder). */
function animateReorder(node: ElementNode, run: () => void) {
  activeGhostCancel?.()
  activeGhostCancel = null
  // reveal any still-hidden prior destination so the new ghost clones visible rows
  if (slidingClearTimer) clearTimeout(slidingClearTimer)
  slidingRange.value = null
  // was the element lifted when the move began? if so it stays lifted for the
  // whole slide so it settles smoothly instead of snapping at the hand-off
  const wasLifted = lifted.value
  const captured = captureBlockGhost(node)
  // arm the highlight transition BEFORE the reorder updates its position, so
  // the class is present when `top`/`height` change (else it jumps)
  if (captured) flashHighlightEase()
  run()
  // moving an element INTO a collapsed group reveals it, so it doesn't land on
  // a hidden line and vanish — the slide below then targets the expanded slot
  if (node.line !== undefined) unfoldAt(node.line)
  if (!captured) return
  nextTick(() => {
    const layer = textLayer.value
    if (!layer || node.line === undefined) {
      captured.ghost.remove()
      return
    }
    const startD = r2d(node.line)
    const row = layer.children[startD] as HTMLElement | undefined
    const to = row?.getBoundingClientRect()
    if (!to || (to.top === captured.from.top && to.left === captured.from.left)) {
      captured.ghost.remove()
      return
    }
    // hide the settled rows so the block isn't seen in two places during the slide
    const endRaw = foldInfo.value.realToDisplay[node.endLine ?? node.line] ?? -1
    slidingRange.value = { start: startD, end: endRaw >= startD ? endRaw : startD }
    // hold the lift for the whole slide, then release it (a Shift-release
    // mid-slide settles smoothly via the 150ms transform transition)
    if (wasLifted) {
      if (liftedSlideTimer) clearTimeout(liftedSlideTimer)
      liftedSlide.value = true
      liftedSlideTimer = setTimeout(() => (liftedSlide.value = false), SLIDE_MS)
    }
    activeGhostCancel = slideGhost(
      captured.ghost,
      `translate(${to.left - captured.from.left}px, ${to.top - captured.from.top}px)`,
      SLIDE_MS,
    )
    // reveal the settled rows just BEFORE the ghost is removed so they overlap
    // (revealing after leaves a brief gap where nothing shows → a flash)
    slidingClearTimer = setTimeout(() => (slidingRange.value = null), SLIDE_MS - 20)
  })
}

function syncScroll(e: Event) {
  const el = e.target as HTMLElement
  scroll.value = { top: el.scrollTop, left: el.scrollLeft }
  if (gutter.value) gutter.value.scrollTop = el.scrollTop
}

// --- cursor & selection sync ---

const cursor = ref(0)
const beforeCursor = computed(() => code.value.slice(0, cursor.value))
const cursorLine = computed(() => beforeCursor.value.split('\n').length - 1)

/** In the setup block the caret may only sit in the editable value area */
function snapToEditable(pos: number): number {
  const lines = code.value.split('\n')
  let lineStart = 0
  let line = 0
  while (line < lines.length && pos > lineStart + lines[line]!.length) {
    lineStart += lines[line]!.length + 1
    line++
  }
  // @setup line → jump to the first editable spot (end of the name value)
  if (line === 0 && lines[0]?.trim() === '@setup') {
    return lines[0]!.length + 1 + (lines[1]?.length ?? 0)
  }
  // label lines → never inside the "name: " part
  const label = lines[line]?.match(/^(\s*(?:name|slug|status|locale): ?)/)
  if (label && pos - lineStart < label[1]!.length) return lineStart + label[1]!.length
  return pos
}

/** Text selection is only allowed between :body and body: — a range
 * reaching into the scaffold is clamped to the body region (or
 * collapsed when the body is empty) */
function clampSelectionToBody(el: HTMLTextAreaElement) {
  if (el.selectionStart === el.selectionEnd) return
  const lines = el.value.split('\n')
  const open = lines.findIndex((l) => /^:body(\[|$)/.test(l.trim()))
  const close = lines.findIndex((l) => l.trim() === 'body:')
  const collapse = () => el.setSelectionRange(el.selectionEnd, el.selectionEnd)
  if (open === -1 || close === -1 || close <= open + 1) return collapse()
  const min = lines.slice(0, open + 1).join('\n').length + 1 // first body line start
  const max = lines.slice(0, close).join('\n').length // last body line end
  const start = Math.max(el.selectionStart, min)
  const end = Math.min(el.selectionEnd, max)
  if (start === el.selectionStart && end === el.selectionEnd) return
  if (start >= end) return collapse()
  el.setSelectionRange(start, end, el.selectionDirection === 'backward' ? 'backward' : 'forward')
}

function trackCursor() {
  const el = input.value
  if (!el) return
  clampSelectionToBody(el)
  let pos = el.selectionStart
  if (el.selectionStart === el.selectionEnd) {
    const snapped = snapToEditable(pos)
    if (snapped !== pos) {
      el.setSelectionRange(snapped, snapped)
      pos = snapped
    }
  }
  cursor.value = pos
  selectByLine(d2r(cursorLine.value))
  trackCaretDwell()
}

/** the caret index at the end of the line containing `pos` (right after the
 * last character, before the line's newline) */
function lineEndAt(value: string, pos: number): number {
  const nl = value.indexOf('\n', pos)
  return nl === -1 ? value.length : nl
}

/** Click lands the caret at the end of the clicked line (a plain, collapsed
 * click only — drag/word/line selections keep their range). */
function onEditorClick() {
  const el = input.value
  if (!el) return
  if (el.selectionStart === el.selectionEnd) {
    const pos = lineEndAt(el.value, el.selectionStart)
    el.setSelectionRange(pos, pos)
  }
  trackCursor()
}

/** ↑/↓ move to the previous/next line and land at its end (no column
 * memory). Bails on any modifier so Shift+↑/↓ (move) and native combos win. */
function onVerticalArrow(e: KeyboardEvent, dir: 'up' | 'down') {
  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
  const el = input.value
  if (!el) return
  const lines = el.value.split('\n')
  const cur = el.value.slice(0, el.selectionStart).split('\n').length - 1
  const target = Math.max(0, Math.min(lines.length - 1, cur + (dir === 'up' ? -1 : 1)))
  const pos = lines.slice(0, target + 1).join('\n').length
  el.setSelectionRange(pos, pos)
  e.preventDefault()
  trackCursor()
}

// selection made on the canvas → move the cursor into that element's block
watch(
  () => selectedElement.value?.id,
  () => {
    const sel = selectedElement.value
    if (!sel || sel.line === undefined) return
    const real = d2r(cursorLine.value)
    if (real >= sel.line && real <= (sel.endLine ?? sel.line)) return
    const selDisplay = r2d(sel.line)
    const lines = code.value.split('\n')
    const pos = lines.slice(0, selDisplay + 1).join('\n').length
    const el = input.value
    if (el) {
      el.setSelectionRange(pos, pos)
      cursor.value = pos
    }
  },
)

// external request (e.g. ⌘E dock insert): pull focus into the editor and
// drop the caret at the end of the selected element's opening line
watch(editorFocusTick, () => {
  const sel = selectedElement.value
  const el = input.value
  if (!sel || sel.line === undefined || !el) return
  const line = sel.line
  unfoldAt(line)
  nextTick(() => {
    const selDisplay = r2d(line)
    const lines = code.value.split('\n')
    const pos = lines.slice(0, selDisplay + 1).join('\n').length
    el.focus()
    el.setSelectionRange(pos, pos)
    cursor.value = pos
    el.scrollTop = Math.max(0, selDisplay * LINE_HEIGHT + PAD_Y - el.clientHeight / 2)
  })
})

// highlighted block: the selected element's source range, else the cursor
// line — mapped into display space, collapsed to the open line when folded
const highlight = computed(() => {
  // span the whole (single or multi) selection; contiguous siblings ⇒ one band
  const nodes = selectedElementIds.value
    .map((id) => getElement(id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.line !== undefined)
  if (nodes.length) {
    const startReal = Math.min(...nodes.map((n) => n.line!))
    const endReal = Math.max(...nodes.map((n) => n.endLine ?? n.line!))
    const endD = foldInfo.value.realToDisplay[endReal] ?? -1
    return { start: r2d(startReal), end: endD >= 0 ? endD : r2d(startReal) }
  }
  const sel = selectedElement.value
  if (sel && sel.line !== undefined) {
    const startD = r2d(sel.line)
    const end = sel.endLine ?? sel.line
    const endD = foldInfo.value.realToDisplay[end] ?? -1
    return { start: startD, end: endD >= 0 ? endD : startD }
  }
  return { start: cursorLine.value, end: cursorLine.value }
})

// a transient preview band for the highlighted (non-selected) element — e.g.
// hovering an interaction's Target button — in display space, null when none
const previewHighlight = computed(() => {
  const node = highlightedElement.value
  if (!node || node.id === selectedElement.value?.id || node.line === undefined) return null
  const startD = r2d(node.line)
  const endD = foldInfo.value.realToDisplay[node.endLine ?? node.line] ?? -1
  return { start: startD, end: endD >= 0 ? endD : startD }
})

// --- gutter drag to reorder ---

function lineFromY(clientY: number) {
  const rect = gutter.value!.getBoundingClientRect()
  const line = Math.floor((clientY - rect.top + scroll.value.top - PAD_Y) / LINE_HEIGHT)
  return Math.max(0, Math.min(lineCount.value - 1, line))
}

/**
 * Resolves a pointer Y to a drop target + position, with edge zones so a
 * block accepts children: its open line's lower part and its close line's
 * upper part read as 'inside' (top of open → before, bottom of close →
 * after). Interior lines already resolve to the deepest child, giving
 * precise placement. This is what lets you drag/move an element INTO a
 * section from the code editor — an empty block has no child line to aim at.
 */
function resolveDrop(clientY: number): { id: string; position: DropPosition } | null {
  const rect = gutter.value!.getBoundingClientRect()
  const raw = (clientY - rect.top + scroll.value.top - PAD_Y) / LINE_HEIGHT
  const display = Math.max(0, Math.min(lineCount.value - 1, Math.floor(raw)))
  const frac = Math.min(Math.max(raw - display, 0), 0.999)
  const node = elementAtLine(d2r(display))
  if (!node) return null
  if (node.type === 'body') return { id: node.id, position: 'inside' }
  // component interiors retarget to the instance root (before/after only —
  // never reshape a shared master from a drag)
  const mapping = masterFor(node.id)
  const target = mapping && mapping.instanceId !== node.id ? getElement(mapping.instanceId) : node
  if (!target || target.line === undefined) return null
  const targetEnd = target.endLine ?? target.line
  const isBlock = targetEnd > target.line && !isComponentType(target.type)
  if (!isBlock) {
    const mid = (target.line + targetEnd) / 2
    return { id: target.id, position: d2r(display) <= mid ? 'before' : 'after' }
  }
  const real = d2r(display)
  if (real === target.line) return { id: target.id, position: frac < 0.25 ? 'before' : 'inside' }
  if (real === targetEnd) return { id: target.id, position: frac > 0.75 ? 'after' : 'inside' }
  return { id: target.id, position: 'inside' }
}

function onGutterDown(line: number, e: MouseEvent) {
  const real = d2r(line)
  const node = elementAtLine(real)
  if (!node) return
  e.preventDefault()
  selectByLine(real)
  if (node.type === 'body') return // selectable, never draggable
  draggingId.value = node.id
  window.addEventListener('mousemove', onGutterMove)
  window.addEventListener('mouseup', onGutterUp)
}

function onGutterMove(e: MouseEvent) {
  if (!draggingId.value) return
  const t = resolveDrop(e.clientY)
  dropTarget.value = t && t.id !== draggingId.value ? t : null
}

function onGutterUp() {
  const dragId = draggingId.value
  const drop = dropTarget.value
  if (dragId && drop) {
    const node = getElement(dragId)
    if (node) animateReorder(node, () => reorderElement(dragId, drop.id, drop.position))
    else reorderElement(dragId, drop.id, drop.position)
  }
  draggingId.value = null
  dropTarget.value = null
  window.removeEventListener('mousemove', onGutterMove)
  window.removeEventListener('mouseup', onGutterUp)
}

// --- keyboard reorder (Shift+↑/↓): the drag, without the mouse ---

// a block is opaque when we won't descend into it — component instances,
// whose interior maps to a shared master with its own sync (leaves aren't
// blocks in the first place, so they never reach this check)
function isOpaque(node: ElementNode): boolean {
  return isComponentType(node.type)
}

/**
 * Moves the selected block one visual slot up or down, mirroring a gutter
 * drag: it descends into an adjacent block, escapes its parent at a
 * boundary, or swaps with a sibling leaf. Routes through reorderElement so
 * indentation, the code re-derive, and reselection all come for free.
 */
function moveSelected(dir: 'up' | 'down'): boolean {
  const s = selectedElement.value
  if (!s || s.type === 'body' || s.line === undefined) return false
  const sEnd = s.endLine ?? s.line

  if (dir === 'up') {
    const prev = s.line - 1
    if (prev < 0) return false
    const p = elementAtLine(prev)
    if (!p || p.id === s.id) return false
    if (p.endLine === prev && p.line !== undefined && p.line < prev) {
      // prev is p's close line → preceding sibling block: descend as its
      // last child (empty block → straight inside; opaque → swap past)
      if (isOpaque(p)) return reorderElement(s.id, p.id, 'before'), true
      if (!p.children.length) return reorderElement(s.id, p.id, 'inside'), true
      const last = p.children[p.children.length - 1]!
      return reorderElement(s.id, last.id, 'after'), true
    }
    // p's open line (S is its first child → escape) or a leaf sibling
    // (swap) — both are 'before p'
    return reorderElement(s.id, p.id, 'before'), true
  }

  const next = sEnd + 1
  const n = elementAtLine(next)
  if (!n || n.id === s.id) return false
  if (n.line === next && (n.endLine ?? n.line) > next) {
    // next is n's open line → following sibling block: descend as its
    // first child (empty block → straight inside; opaque → swap past)
    if (isOpaque(n)) return reorderElement(s.id, n.id, 'after'), true
    if (!n.children.length) return reorderElement(s.id, n.id, 'inside'), true
    return reorderElement(s.id, n.children[0]!.id, 'before'), true
  }
  // n's close line (S is its last child → escape) or a leaf sibling
  // (swap) — both are 'after n'
  return reorderElement(s.id, n.id, 'after'), true
}

/** Carries the textarea caret onto the currently selected element's line.
 * Runs after structural edits whose selection→caret watcher won't fire (the
 * node id is unchanged, e.g. a move) or can't be relied on, so keyup's
 * trackCursor doesn't reselect from the stale caret line (usually the body). */
function syncCaretToSelected() {
  nextTick(() => {
    const sel = selectedElement.value
    const el = input.value
    if (!sel || sel.line === undefined || !el) return
    const lines = code.value.split('\n')
    const pos = lines.slice(0, r2d(sel.line) + 1).join('\n').length
    el.setSelectionRange(pos, pos)
    cursor.value = pos
  })
}

/** Shift+Arrow keydown; only swallows the key when a move actually happens
 * so text-selection with Shift+Arrow still works otherwise */
function onMoveKey(e: KeyboardEvent, dir: 'up' | 'down') {
  if (e.metaKey || e.ctrlKey) return // ⌘⇧↑/↓ is multi-select extend, not move
  // move the whole selection as a group among its siblings
  if (isMultiSelect.value) {
    if (moveSelectionGroup(dir)) {
      e.preventDefault()
      syncCaretToSelected()
    }
    return
  }
  const node = selectedElement.value
  if (!node) return
  let moved = false
  animateReorder(node, () => {
    moved = moveSelected(dir)
  })
  if (!moved) return
  e.preventDefault()
  syncCaretToSelected()
}

/** The innermost foldable block (endLine > line) enclosing the current
 * selection — the selected group itself, or the nearest ancestor group when
 * a leaf is selected. Null when nothing around the selection is foldable. */
function foldTargetId(): string | null {
  const sel = selectedElement.value
  if (!sel || sel.line === undefined) return null
  const line = sel.line
  let bestId: string | null = null
  let bestLine = -1
  walkNodes(activePage.value.elements, (n) => {
    if (
      n.type !== 'body' && // never fold the whole document
      n.line !== undefined &&
      n.endLine !== undefined &&
      n.endLine > n.line &&
      n.line <= line &&
      line <= n.endLine &&
      n.line > bestLine
    ) {
      bestId = n.id
      bestLine = n.line
    }
  })
  return bestId
}

/** Shift+←/→ folds / unfolds the selected group (or, from a leaf, the group
 * it lives in). Only swallows the key when it actually toggles a fold, so
 * native Shift+Arrow selection still works everywhere else. */
function onFoldKey(e: KeyboardEvent, dir: 'collapse' | 'expand') {
  const id = foldTargetId()
  if (!id) return
  const folded = foldedIds.value.has(id)
  if (dir === 'collapse' ? folded : !folded) return // nothing to change
  const next = new Set(foldedIds.value)
  if (dir === 'collapse') next.add(id)
  else next.delete(id)
  foldedIds.value = next
  // move the selection onto the group header so it isn't stranded on a
  // now-hidden inner line (a no-op when the group was already selected)
  selectElement(id)
  e.preventDefault()
  syncCaretToSelected()
}

// drop indicator: the line index the block would land on
const dropLine = computed(() => {
  if (!dropTarget.value) return null
  const node = getElement(dropTarget.value.id)
  if (!node || node.line === undefined) return null
  const real =
    dropTarget.value.position === 'before'
      ? node.line
      : dropTarget.value.position === 'inside'
        ? (node.endLine ?? node.line) // last child lands on the close line
        : (node.endLine ?? node.line) + 1
  return r2d(real)
})

// --- palette insert-drags dropped over the editor ---

// same sibling semantics as the gutter reorder: before/after by
// midpoint, body takes children, scaffold lines reject; interior
// component-instance lines retarget to the instance root
onMounted(() =>
  registerCodeResolver((clientY) => resolveDrop(clientY)),
)
onBeforeUnmount(() => {
  registerCodeResolver(null)
  if (resolvedTimer) clearTimeout(resolvedTimer)
})

// --- validation ---

// validate the FULL source so folded (hidden) close lines don't read
// as unclosed; diagnostic line indices are real
const allDiagnostics = computed(() =>
  validateDocument(rawSource.value, componentNames.value, collectionNames.value, listFieldNames.value),
)

// The line the caret is on gets a grace period so a half-typed token doesn't
// flicker red — UNLESS it was already erroring when the caret arrived. Once a
// line is in an error state we keep validating it live (so you watch it clear
// as you fix it) until the caret moves to another line.
const activeLineErrored = ref(false)
watch(
  () => d2r(cursorLine.value),
  (real) => {
    activeLineErrored.value = allDiagnostics.value.some((d) => d.line === real)
  },
  { immediate: true },
)

const diagnostics = computed(() => {
  if (activeLineErrored.value) return allDiagnostics.value // sticky: validate the current line live too
  const currentReal = d2r(cursorLine.value)
  return allDiagnostics.value.filter((d) => d.line !== currentReal)
})

/** real line indices that carry a diagnostic — used to recolor the gutter
 * number and the syntax tokens on those lines */
const errorLines = computed(() => new Set(diagnostics.value.map((d) => d.line)))
function isErrorLine(displayIndex: number): boolean {
  return errorLines.value.has(d2r(displayIndex))
}

// whether the floating pill's message list is expanded; auto-collapses once
// the document is valid again
const showDiagnostics = ref(false)

// The pill is normally hidden when the code is valid. It shows while there
// are issues, and flashes a "No issues" confirmation for 2s right after the
// last issue is resolved, then fades away.
const justResolved = ref(false)
let resolvedTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => diagnostics.value.length,
  (n, prev) => {
    if (n > 0) {
      // issues present → cancel any lingering "No issues" flash
      justResolved.value = false
      if (resolvedTimer) (clearTimeout(resolvedTimer), (resolvedTimer = null))
      return
    }
    showDiagnostics.value = false
    if (prev && prev > 0) {
      // just went from issues → clean: flash the confirmation briefly
      justResolved.value = true
      if (resolvedTimer) clearTimeout(resolvedTimer)
      resolvedTimer = setTimeout(() => {
        justResolved.value = false
        resolvedTimer = null
      }, 2000)
    }
  },
)
const pillVisible = computed(() => diagnostics.value.length > 0 || justResolved.value)

function jumpToLine(real: number) {
  const el = input.value
  if (!el) return
  unfoldAt(real) // reveal the line if it's inside a collapsed block
  const display = r2d(real)
  const pos = code.value.split('\n').slice(0, display + 1).join('\n').length
  el.focus()
  el.setSelectionRange(pos, pos)
  el.scrollTop = Math.max(0, display * LINE_HEIGHT - el.clientHeight / 2)
  trackCursor()
}

// --- syntax coloring (Moonlight palette): scaffold muted, per-token colors ---

type Tone = 'plain' | 'muted' | 'keyword' | 'arg' | 'string' | 'punct' | 'component'

interface LinePart {
  text: string
  tone: Tone
  /** lines inside a component block render dimmed */
  dim?: boolean
}

const TONE_CLASS: Record<Tone, string> = {
  plain: 'text-editor-fg',
  muted: 'text-editor-comment',
  keyword: 'text-editor-keyword',
  arg: 'text-editor-arg',
  string: 'text-editor-string',
  punct: 'text-editor-punct',
  component: 'text-editor-component',
}

// splits `:h1[title]:` into keyword / punct / arg parts; the token regex is
// deliberately loose so incomplete mid-typing tokens (`:collection-list[`)
// still color instead of falling back to plain
function tokenizeLine(text: string, dim?: boolean): LinePart[] {
  const m = text.match(/^(\s*)(.*?)(\s*)$/)!
  const [, indent, token, trail] = m as unknown as [string, string, string, string]
  const parts: LinePart[] = []
  if (indent) parts.push({ text: indent, tone: 'plain', dim })
  if (token) {
    const t = token.match(/^(:?)([A-Za-z][A-Za-z0-9-]*)(?:(\[)([^\]]*)(\]?))?(\(\+?\)?)?(\{\+?\}?)?(:?)$/)
    if (!t) parts.push({ text: token, tone: 'plain', dim })
    else {
      const [, lead, name, open, arg, close, marker, brace, colon] = t
      if (lead) parts.push({ text: lead, tone: 'punct', dim })
      parts.push({ text: name!, tone: 'keyword', dim })
      if (open) parts.push({ text: open, tone: 'punct', dim })
      if (arg) parts.push({ text: arg, tone: 'arg', dim })
      if (close) parts.push({ text: close, tone: 'punct', dim })
      if (marker) parts.push({ text: marker, tone: 'arg', dim })
      if (brace) parts.push({ text: brace, tone: 'arg', dim })
      if (colon) parts.push({ text: colon, tone: 'punct', dim })
    }
  }
  if (trail) parts.push({ text: trail, tone: 'plain', dim })
  return parts
}

// styled per REAL line (so component-depth tracking sees hidden lines),
// then filtered down to the visible display rows
const styledLines = computed<LinePart[][]>(() => {
  const lines = rawSource.value.split('\n')
  const bodyOpen = lines.findIndex((l) => /^:body(\[|$)/.test(l.trim()))
  let componentDepth = 0
  const real = lines.map((text, i): LinePart[] => {
    const t = text.trim()
    if (t === '@setup' || /^:body(\[|$)/.test(t) || t === 'body:') return [{ text, tone: 'muted' }]
    if (COMPONENT_TOKEN.test(t)) {
      if (/^[A-Z]/.test(t)) componentDepth = Math.max(0, componentDepth - 1) // Card:
      else if (!t.endsWith(':')) componentDepth++ // :Card (leaf :Card: leaves depth alone)
      const indent = text.match(/^\s*/)![0]
      const [, lead, name, colon] = t.match(/^(:?)([A-Za-z][A-Za-z0-9-]*)(:?)$/)!
      return [
        ...(indent ? [{ text: indent, tone: 'plain' as Tone }] : []),
        ...(lead ? [{ text: lead, tone: 'punct' as Tone }] : []),
        { text: name!, tone: 'component' },
        ...(colon ? [{ text: colon, tone: 'punct' as Tone }] : []),
      ]
    }
    if (componentDepth > 0) return tokenizeLine(text, true)
    if (i > 0 && bodyOpen !== -1 && i < bodyOpen) {
      const m = text.match(/^(\s*(?:name|slug|status|locale): ?)(.*)$/)
      if (m) {
        return [
          { text: m[1]!, tone: 'muted' },
          { text: m[2]!, tone: 'string' },
        ]
      }
      return [{ text, tone: 'muted' }]
    }
    return tokenizeLine(text)
  })
  return foldInfo.value.displayToReal.map((realLine) => {
    const parts = real[realLine]!
    return foldableAt.value.get(realLine) && foldRanges.value.some((r) => r.start === realLine)
      ? [...parts, { text: ' ⋯', tone: 'muted' }]
      : parts
  })
})

// "Add syntax here" hint on the empty body's placeholder line (display index)
const placeholderLine = computed(() => {
  const body = activePage.value.elements.find((n) => n.type === 'body')
  if (body && body.children.length > 0) return null
  const bodyReal = rawSource.value.split('\n').findIndex((l) => /^:body(\[|$)/.test(l.trim()))
  if (bodyReal === -1) return null
  const line = r2d(bodyReal + 1)
  return cursorLine.value === line ? null : line
})

// --- ghost suggestion ---

const dismissed = ref(false)

const ghost = computed(() => {
  if (dismissed.value) return ''
  const value = code.value
  const pos = cursor.value
  // only at the end of a line with nothing after the cursor
  const lineEnd = value.indexOf('\n', pos)
  if (value.slice(pos, lineEnd === -1 ? value.length : lineEnd).trim()) return ''

  const lines = beforeCursor.value.split('\n')
  const currentLine = lines.pop() ?? ''

  const suggestion = suggestCompletion(lines.join('\n'), currentLine, componentNames.value, {
    pages: pagePaths.value,
    onTemplate: !!activePage.value.collectionId,
  })
  if (!suggestion) return ''
  return suggestion.slice(currentLine.length)
})

function insertAtCursor(text: string) {
  const el = input.value!
  const { selectionStart, selectionEnd, value } = el
  el.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd)
  el.selectionStart = el.selectionEnd = selectionStart + text.length
  code.value = el.value
  // completions go through the same pipeline as typing, so accepted
  // component tokens expand exactly like typed ones
  onInput()
}

function onTab() {
  // accept only when the ghost continues the cursor directly — a ghost that
  // starts with whitespace means the cursor isn't at the suggestion's indent
  // yet, so Tab indents toward it instead of accepting
  if (ghost.value && !/^\s/.test(ghost.value)) insertAtCursor(ghost.value)
  else insertAtCursor('\t')
}

/** Does the block opened on line `openIdx` already have its matching close
 * somewhere below? A close of a DIFFERENT name at the same depth (e.g. the
 * enclosing `body:`) is the scope boundary — that means unclosed. */
function blockClosedBelow(lines: string[], openIdx: number, name: string): boolean {
  let depth = 0
  for (let i = openIdx + 1; i < lines.length; i++) {
    const t = lines[i]!.trim()
    if (!t) continue
    if (OPEN.test(t)) {
      depth++
      continue
    }
    const close = t.match(CLOSE)
    if (close) {
      if (depth === 0) return close[1] === name
      depth--
    }
  }
  return false
}

/**
 * The smart-Enter edit for a caret: auto-indents the new line to the DSL
 * context (one deeper after a block-open, else the current depth) and, when
 * opening an unclosed block, drops the caret on an indented child line with
 * the matching close placed below. Returns null to defer to a plain newline.
 */
function computeEnterEdit(
  value: string,
  caret: number,
  blockIsFolded = false,
): { anchor: number; text: string; caret: number } | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const nlAfter = value.indexOf('\n', caret)
  const lineEnd = nlAfter === -1 ? value.length : nlAfter
  // only smart-handle at the end of a line (nothing but whitespace ahead)
  if (value.slice(caret, lineEnd).trim() !== '') return null

  const lines = value.split('\n')
  const lineIndex = value.slice(0, lineStart).split('\n').length - 1
  const bodyOpen = lines.findIndex((l) => /^:body(\[|$)/.test(l.trim()))
  const bodyClose = lines.findIndex((l) => l.trim() === 'body:')
  // stay within the editable body region — @setup and the scaffold defer
  if (bodyOpen === -1 || bodyClose === -1 || lineIndex <= bodyOpen || lineIndex >= bodyClose) {
    return null
  }

  const fullLine = value.slice(lineStart, lineEnd)
  const indent = fullLine.match(/^\t*/)![0].length
  const trimmed = fullLine.trim()
  const open = trimmed.match(OPEN)
  const name = open?.[1]
  const isBlockOpen = !!name && name !== 'body' && (isKnownElement(name) || isComponentType(name))

  const t = (n: number) => '\t'.repeat(n)
  if (isBlockOpen) {
    const child = '\n' + t(indent + 1)
    // a folded block's close line is hidden from `lines`, so trust the fold:
    // it only exists for a block that already has its close (endLine > line)
    if (blockIsFolded || blockClosedBelow(lines, lineIndex, name!)) {
      return { anchor: lineEnd, text: child, caret: lineEnd + child.length }
    }
    return { anchor: lineEnd, text: child + '\n' + t(indent) + name + ':', caret: lineEnd + child.length }
  }
  const sibling = '\n' + t(indent)
  return { anchor: lineEnd, text: sibling, caret: lineEnd + sibling.length }
}

/** Enter keydown: smart-indent within the body; otherwise let the browser
 * insert a plain newline (mid-line splits, @setup, ranged selections) */
function onEnter(e: KeyboardEvent) {
  const el = input.value!
  if (el.selectionStart !== el.selectionEnd) return
  const caretLine = el.value.slice(0, el.selectionStart).split('\n').length - 1
  const edit = computeEnterEdit(el.value, el.selectionStart, isFolded(caretLine))
  if (!edit) return
  e.preventDefault()
  const value = el.value
  const next = value.slice(0, edit.anchor) + edit.text + value.slice(edit.anchor)
  el.value = next
  el.selectionStart = el.selectionEnd = edit.caret
  code.value = next
  trackCursor()
}

// --- token-typed panel sessions: typing '(' on an element token opens the
// Style panel (ESC finalizes it as the '(+)' styled marker, or removes it
// when the element has no classes); typing '[' opens the Data panel (ESC
// closes a typed arg — ':h1[po' → ':h1[po]:' — or removes an empty '[');
// typing '{' opens the Interactions panel (ESC finalizes as the '{+}'
// marker, or removes it when the element has no interactions) ---

const styleParenSession = ref<{ nodeId: string; pageId: string } | null>(null)
const dataBracketSession = ref<{ nodeId: string; pageId: string } | null>(null)
const interactionBraceSession = ref<{ nodeId: string; pageId: string } | null>(null)

/** the element whose open line is `real` — panels only target real,
 * non-body elements addressed by their own line */
function panelTargetAt(real: number): ElementNode | null {
  const node = elementAtLine(real)
  if (!node || node.type === 'body' || node.line !== real) return null
  return node
}

type PanelKind = 'style' | 'data' | 'interactions'

/** selects the node, records the session, and opens the matching panel */
function startPanelSession(kind: PanelKind, node: ElementNode) {
  selectElement(node.id)
  const session = { nodeId: node.id, pageId: activePage.value.id }
  if (kind === 'style') styleParenSession.value = session
  else if (kind === 'data') dataBracketSession.value = session
  else interactionBraceSession.value = session
  openPanel(kind, { focus: true })
}

/** caret sits right after a bare '(' at the end of an element token's head */
function maybeOpenStyleParen(el: HTMLTextAreaElement) {
  const pos = el.selectionStart
  const value = el.value
  if (value[pos - 1] !== '(') return
  if (value[pos] === '+' || value[pos] === ')') return // already a marker
  const lineStart = value.lastIndexOf('\n', pos - 2) + 1
  const head = value.slice(lineStart, pos).trimStart()
  // closed [arg] required before the paren, so '(' typed inside brackets
  // (or on @setup/close lines) never triggers
  if (!/^:[a-zA-Z][a-zA-Z0-9-]*(?:\[[a-z0-9.-]*\])?\($/.test(head)) return
  const node = panelTargetAt(d2r(value.slice(0, pos).split('\n').length - 1))
  if (!node) return
  // component instances style their shared master — no per-node marker there
  if (isComponentType(node.type) || masterFor(node.id)) return
  startPanelSession('style', node)
}

/** caret sits right after a bare '{' following the token head (name, optional
 * [arg], optional (+) style marker) */
function maybeOpenInteractionBrace(el: HTMLTextAreaElement) {
  const pos = el.selectionStart
  const value = el.value
  if (value[pos - 1] !== '{') return
  if (value[pos] === '+' || value[pos] === '}') return // already a marker
  const lineStart = value.lastIndexOf('\n', pos - 2) + 1
  const head = value.slice(lineStart, pos).trimStart()
  if (!/^:[a-zA-Z][a-zA-Z0-9-]*(?:\[[a-z0-9.-]*\])?(?:\(\+\))?\{$/.test(head)) return
  const node = panelTargetAt(d2r(value.slice(0, pos).split('\n').length - 1))
  if (!node) return
  // component instances get interactions from their shared master — no
  // per-node marker there (same rule as styles)
  if (isComponentType(node.type) || masterFor(node.id)) return
  startPanelSession('interactions', node)
}

/** caret sits right after a fresh '[' at the end of an element token's name —
 * retyping inside an existing arg never re-triggers */
function maybeOpenDataBracket(el: HTMLTextAreaElement) {
  const pos = el.selectionStart
  const value = el.value
  if (value[pos - 1] !== '[') return
  const lineStart = value.lastIndexOf('\n', pos - 2) + 1
  const head = value.slice(lineStart, pos).trimStart()
  if (!/^:[a-zA-Z][a-zA-Z0-9-]*\[$/.test(head)) return
  const node = panelTargetAt(d2r(value.slice(0, pos).split('\n').length - 1))
  if (!node) return
  // component instances allowed — content and args are per-instance
  startPanelSession('data', node)
}

// --- caret-dwell reopen: resting the caret inside an existing [ … ], ( … )
// or { … } on a token reopens that panel — keyboard-only reopening for
// elements already carrying an arg or a marker. A short dwell keeps a caret
// merely arrowing THROUGH the token from firing panels (and stealing focus)
// at every span it crosses. ---

const CARET_DWELL_MS = 350
// the token head's three spans, in source order, possibly mid-typing
const HEAD_SPANS = /^(\s*:[a-zA-Z][a-zA-Z0-9-]*)(\[[a-z0-9.-]*\]?)?(\(\+?\)?)?(\{\+?\}?)?/

/** which panel span the (collapsed, editor-focused) caret sits inside */
function caretSpanKind(): PanelKind | null {
  const el = input.value
  if (!el || document.activeElement !== el || el.selectionStart !== el.selectionEnd) return null
  const before = beforeCursor.value
  const col = before.length - before.lastIndexOf('\n') - 1
  const line = code.value.split('\n')[cursorLine.value] ?? ''
  const m = line.match(HEAD_SPANS)
  if (!m || !m[1]) return null
  let pos = m[1].length
  const spans: [PanelKind, string | undefined][] = [
    ['data', m[2]],
    ['style', m[3]],
    ['interactions', m[4]],
  ]
  for (const [kind, text] of spans) {
    if (!text) continue
    // inside = strictly after the opener, at or before the closer
    const last = pos + text.length - (/[\])}]$/.test(text) ? 1 : 0)
    if (col > pos && col <= last) return kind
    pos += text.length
  }
  return null
}

let caretDwellTimer: ReturnType<typeof setTimeout> | null = null
// spans only (re)open on an entry TRANSITION — a caret already inside when
// focus returns (e.g. after ESC restores it) doesn't immediately reopen
let lastCaretSpan: PanelKind | null = null

onBeforeUnmount(() => {
  if (caretDwellTimer) clearTimeout(caretDwellTimer)
})

function trackCaretDwell() {
  const span = caretSpanKind()
  if (span === lastCaretSpan) return
  lastCaretSpan = span
  if (caretDwellTimer) {
    clearTimeout(caretDwellTimer)
    caretDwellTimer = null
  }
  if (!span || activePanelId.value === span) return
  caretDwellTimer = setTimeout(() => {
    caretDwellTimer = null
    if (caretSpanKind() !== span || activePanelId.value === span) return
    const node = panelTargetAt(d2r(cursorLine.value))
    if (!node) return
    // style/interactions live on component masters — same exclusion as typing
    if (span !== 'data' && (isComponentType(node.type) || masterFor(node.id))) return
    startPanelSession(span, node)
  }, CARET_DWELL_MS)
}

function finalizeStyleParen() {
  const session = styleParenSession.value
  if (!session) return
  styleParenSession.value = null
  const page = activePage.value
  if (!page || page.id !== session.pageId) return
  const lines = page.code.split('\n')
  const node = getElement(session.nodeId)
  if (node && node.line !== undefined && lines[node.line] !== undefined) {
    const next = withStyleMarker(lines[node.line]!, !!node.classes?.trim())
    if (next === lines[node.line]) return
    lines[node.line] = next
  } else {
    // node gone mid-session — drop any stray incomplete '(' it left behind
    let changed = false
    for (let i = 0; i < lines.length; i++) {
      const marker = styleMarkerOf(lines[i]!)
      if (marker && marker !== '(+)') {
        lines[i] = withStyleMarker(lines[i]!, false)
        changed = true
      }
    }
    if (!changed) return
  }
  page.code = lines.join('\n')
}

function finalizeDataBracket() {
  const session = dataBracketSession.value
  if (!session) return
  dataBracketSession.value = null
  const page = activePage.value
  if (!page || page.id !== session.pageId) return
  const lines = page.code.split('\n')
  const node = getElement(session.nodeId)
  if (node && node.line !== undefined && lines[node.line] !== undefined) {
    const line = lines[node.line]!
    const next = closeArgBracket(line)
    if (next === line) return // already closed (panel wrote the arg) or retyped
    lines[node.line] = next
    // code is authoritative for the arg: a typed arg the close just sealed
    // becomes node.arg; a removed empty '[' clears it
    const arg = next.match(/^\s*:[a-zA-Z][a-zA-Z0-9-]*\[([a-z0-9.-]+)\]/)?.[1]
    node.arg = arg ?? undefined
  } else {
    // node gone mid-session — drop any stray unclosed '[' it left behind
    let changed = false
    for (let i = 0; i < lines.length; i++) {
      if (hasOpenArgBracket(lines[i]!)) {
        lines[i] = closeArgBracket(lines[i]!)
        changed = true
      }
    }
    if (!changed) return
  }
  page.code = lines.join('\n')
}

function finalizeInteractionBrace() {
  const session = interactionBraceSession.value
  if (!session) return
  interactionBraceSession.value = null
  const page = activePage.value
  if (!page || page.id !== session.pageId) return
  const lines = page.code.split('\n')
  const node = getElement(session.nodeId)
  if (node && node.line !== undefined && lines[node.line] !== undefined) {
    const next = withInteractionMarker(lines[node.line]!, !!node.interactions?.length)
    if (next === lines[node.line]) return
    lines[node.line] = next
  } else {
    // node gone mid-session — drop any stray incomplete '{' it left behind
    let changed = false
    for (let i = 0; i < lines.length; i++) {
      const marker = interactionMarkerOf(lines[i]!)
      if (marker && marker !== '{+}') {
        lines[i] = withInteractionMarker(lines[i]!, false)
        changed = true
      }
    }
    if (!changed) return
  }
  page.code = lines.join('\n')
}

watch(activePanelId, (_now, was) => {
  if (was === 'style') finalizeStyleParen()
  if (was === 'data') finalizeDataBracket()
  if (was === 'interactions') finalizeInteractionBrace()
})
watch(
  () => activePage.value.id,
  () => {
    styleParenSession.value = null
    dataBracketSession.value = null
    interactionBraceSession.value = null
  },
)

// keeps '(+)' / '{+}' in step with node.classes / node.interactions no matter
// where they change (panels, canvas, MCP, paste/duplicate — new node ids
// re-fire it too)
const markersSig = computed(() => {
  const parts: string[] = []
  const visit = (nodes: ElementNode[]) => {
    for (const n of nodes) {
      parts.push(`${n.id}:${n.classes ?? ''}:${n.interactions?.length ?? 0}`)
      if (!isComponentType(n.type)) visit(n.children)
    }
  }
  visit(activePage.value.elements)
  return parts.join('|')
})
watch(markersSig, () => syncNodeMarkers())

function onInput() {
  dismissed.value = false
  const el = input.value!
  // folded view: reconstruct full code, run the normal pipeline, then
  // re-collapse for display (kept separate so the common no-fold path
  // below stays byte-for-byte unchanged)
  if (foldRanges.value.length) {
    const oldDisplay = el.value
    const caret = el.selectionStart
    const full = expandCode(rawSource.value, foldRanges.value, oldDisplay)
    const { code: normalized } = enforceDocument(full)
    store(expandComponentInstances(normalized, components.value))
    const newDisplay = code.value
    const target = oldDisplay.slice(0, caret).replace(/\s/g, '').length
    let pos = 0
    for (let seen = 0; pos < newDisplay.length && seen < target; pos++) {
      if (!/\s/.test(newDisplay[pos]!)) seen++
    }
    if (oldDisplay[caret - 1] === '\n' && newDisplay[pos] === '\n') {
      pos++
      while (newDisplay[pos] === '\t') pos++
    }
    el.value = newDisplay
    el.selectionStart = el.selectionEnd = Math.min(pos, newDisplay.length)
    trackCursor()
    maybeOpenStyleParen(el)
    maybeOpenDataBracket(el)
    maybeOpenInteractionBrace(el)
    return
  }
  const caretLine = el.value.slice(0, el.selectionStart).split('\n').length - 1
  // @setup values are routed to the page or loaded entry by code's setter
  const { code: normalized } = enforceDocument(el.value)
  // a freshly typed :Card: (or empty :Card / Card: pair) unfolds into
  // the component's full editable structure
  const expanded = expandComponentInstances(normalized, components.value)
  if (expanded !== normalized) {
    // caret to the end of the component's open line
    const lines = expanded.split('\n')
    const pos = lines.slice(0, caretLine + 1).join('\n').length
    el.value = expanded
    el.selectionStart = el.selectionEnd = Math.min(pos, expanded.length)
    code.value = expanded
  } else if (normalized !== el.value) {
    // remap the cursor by counting non-whitespace chars before it —
    // normalization only rewrites whitespace, so that count is stable
    const atLineStart = el.value[el.selectionStart - 1] === '\n'
    const target = el.value.slice(0, el.selectionStart).replace(/\s/g, '').length
    let pos = 0
    for (let seen = 0; pos < normalized.length && seen < target; pos++) {
      if (!/\s/.test(normalized[pos]!)) seen++
    }
    // the cursor was on a fresh line → follow it onto the next line's indent
    if (atLineStart && normalized[pos] === '\n') {
      pos++
      while (normalized[pos] === '\t') pos++
    }
    el.value = normalized
    el.selectionStart = el.selectionEnd = pos
    code.value = normalized
  }
  trackCursor()
  maybeOpenStyleParen(el)
  maybeOpenDataBracket(el)
  maybeOpenInteractionBrace(el)
}
</script>

<template>
  <div
    data-insert-code-surface
    class="relative flex h-full flex-col overflow-hidden bg-background font-mono text-[10px] leading-5 tab-2"
  >
    <div class="flex flex-1 overflow-hidden px-2">
    <div
      ref="gutter"
      class="shrink-0 select-none overflow-hidden pr-1 text-muted-foreground"
    >
      <div
        v-for="n in lineCount"
        :key="n"
        class="group/g flex h-5 cursor-grab items-center justify-end gap-1"
        @mousedown="onGutterDown(n - 1, $event)"
      >
        <span class="w-6 text-right" :class="{ 'text-danger': isErrorLine(n - 1) }">{{ d2r(n - 1) + 1 }}</span>
        <button
          v-if="foldableAtDisplay(n - 1)"
          class="flex w-3 cursor-pointer items-center text-muted-foreground hover:text-foreground"
          :class="isFolded(n - 1) ? 'opacity-100' : 'opacity-0 group-hover/g:opacity-100'"
          @mousedown.stop
          @click.stop="toggleFold(n - 1)"
        >
          <component :is="isFolded(n - 1) ? ChevronRight : ChevronDown" class="size-3" />
        </button>
        <span v-else class="w-3"></span>
      </div>
    </div>

    <div class="relative flex-1 overflow-hidde">
      <!-- current element/group background, VS Code style -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          class="absolute inset-x-0 bg-muted/50 rounded-md"
          :style="{
            top: `${PAD_Y + highlight.start * LINE_HEIGHT - scroll.top}px`,
            height: `${(highlight.end - highlight.start + 1) * LINE_HEIGHT}px`,
            transform: lifted ? 'scale(1.06)' : undefined,
            transformOrigin: 'left center',
            transition: highlightEase
              ? `top ${SLIDE_MS}ms ease-out, height ${SLIDE_MS}ms ease-out, transform 150ms ease-out`
              : 'transform 150ms ease-out',
          }"
        ></div>
        <!-- preview highlight: an interaction's Target, hovered from the panel -->
        <div
          v-if="previewHighlight"
          class="absolute inset-x-0 rounded-md outline outline-1 -outline-offset-1 outline-emerald-500/70 bg-emerald-500/10"
          :style="{
            top: `${PAD_Y + previewHighlight.start * LINE_HEIGHT - scroll.top}px`,
            height: `${(previewHighlight.end - previewHighlight.start + 1) * LINE_HEIGHT}px`,
          }"
        ></div>
        <div
          v-if="dropLine !== null"
          class="absolute inset-x-0 h-0.5 bg-sky-500"
          :style="{ top: `${PAD_Y + dropLine * LINE_HEIGHT - scroll.top - 1}px` }"
        ></div>
      </div>

      <!-- colored text layer: scaffold muted, editable code per-token Moonlight colors -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden px-2">
        <div ref="textLayer" :style="{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }">
          <div
            v-for="(parts, i) in styledLines"
            :key="i"
            class="h-5 whitespace-pre transition-[filter]"
            :class="[
              { 'brightness-125': i >= highlight.start && i <= highlight.end },
              isErrorLine(i) && '[&>span]:!text-danger',
            ]"
            :style="rowStyle(i)"
          ><span
              v-for="(part, j) in parts"
              :key="j"
              :class="[TONE_CLASS[part.tone], part.dim && 'opacity-60']"
            >{{ part.text }}</span><span
              v-if="i === placeholderLine"
              class="italic text-editor-comment/60"
            >Add syntax here</span></div>
        </div>
      </div>

      <textarea
        ref="input"
        v-model="code"
        spellcheck="false"
        class="code-scrollbar relative h-full w-full resize-none overflow-auto whitespace-pre bg-transparent px-2 text-transparent caret-editor-fg outline-none tab-2"
        @scroll="syncScroll"
        @input="onInput"
        @click="onEditorClick"
        @keyup="trackCursor"
        @select="trackCursor"
        @contextmenu="onContextMenu"
        @keydown="onShortcutKeydown"
        @keydown.tab.prevent="onTab"
        @keydown.enter="onEnter"
        @keydown.shift.up="onMoveKey($event, 'up')"
        @keydown.shift.down="onMoveKey($event, 'down')"
        @keydown.shift.left="onFoldKey($event, 'collapse')"
        @keydown.shift.right="onFoldKey($event, 'expand')"
        @keydown.up="onVerticalArrow($event, 'up')"
        @keydown.down="onVerticalArrow($event, 'down')"
        @keydown.esc="dismissed = true"
      ></textarea>

      <!-- status caret: invisible copy of the status line positions a
           mini dropdown right after its text -->
      <div v-if="statusLine" class="pointer-events-none absolute inset-0 overflow-hidden px-2">
        <div
          class="whitespace-pre"
          :style="{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }"
        >
          <div
            ref="statusRef"
            class="flex h-5 items-center"
            :style="{ marginTop: `${statusLine.line * LINE_HEIGHT}px` }"
          >
            <span class="invisible">{{ statusLine.text }}</span>
            <span class="pointer-events-auto relative ml-1">
              <button
                class="flex cursor-pointer items-center text-editor-comment hover:text-editor-fg"
                @click="statusOpen = !statusOpen"
              >
                <ChevronDown class="size-3" />
              </button>
              <div
                v-if="statusOpen"
                class="absolute top-full left-0 z-10 mt-1 min-w-24 rounded-md border border-input bg-background py-0.5 shadow-md"
              >
                <button
                  v-for="s in PAGE_STATUSES"
                  :key="s"
                  class="block w-full cursor-pointer px-2 py-0.5 text-left hover:bg-muted/50"
                  :class="s === activePage.status ? 'text-editor-string' : 'text-muted-foreground'"
                  @click="setStatus(s)"
                >
                  {{ s }}
                </button>
              </div>
            </span>
          </div>
        </div>
      </div>

      <!-- mirror overlay: invisible text up to the cursor, then the ghost -->
      <div v-if="ghost" class="pointer-events-none absolute inset-0 overflow-hidden px-2">
        <div
          class="whitespace-pre"
          :style="{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }"
        ><span class="invisible">{{ beforeCursor }}</span><span class="text-editor-comment/70">{{ ghost }}</span></div>
      </div>
    </div>
    </div>

    <!-- floating validation pill, bottom-center of the code pane -->
    <div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-2">
      <Transition name="pill">
      <div v-if="pillVisible" class="pointer-events-auto flex w-56 flex-col">
        <!-- expanded message list (pops above the pill) -->
        <div
          v-if="showDiagnostics && diagnostics.length"
          class="mb-1 max-h-48 overflow-y-auto rounded-xl border border-input bg-background shadow-lg"
        >
          <button
            v-for="(d, i) in diagnostics"
            :key="i"
            class="flex w-full items-start gap-1.5 px-3 py-1 text-left text-muted-foreground hover:bg-muted/50"
            @click="jumpToLine(d.line)"
          >
            <CircleAlert class="mt-px size-3 shrink-0 text-danger" />
            <span>{{ d.message }}</span>
          </button>
        </div>

        <button
          class="flex items-center justify-center gap-1.5 self-center rounded-full border border-input bg-background px-3 py-1 shadow-md"
          :class="diagnostics.length ? 'cursor-pointer text-danger' : 'cursor-default text-success'"
          @click="diagnostics.length && (showDiagnostics = !showDiagnostics)"
        >
          <component :is="diagnostics.length ? CircleAlert : CircleCheck" class="size-3 shrink-0" />
          <span>{{
            diagnostics.length
              ? `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}`
              : 'No issues'
          }}</span>
        </button>
      </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* validation pill: fades in while sliding up, fades out while sliding down */
.pill-enter-active,
.pill-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.pill-enter-from,
.pill-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* the scrollbar only shows while the editor is focused; the track keeps
   its 6px footprint either way so focusing never shifts the layout */
.code-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.code-scrollbar:focus {
  scrollbar-color: color-mix(in oklch, var(--muted-foreground) 35%, transparent) transparent;
}
.code-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.code-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.code-scrollbar::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 9999px;
}
.code-scrollbar:focus::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--muted-foreground) 35%, transparent);
}
.code-scrollbar:focus::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklch, var(--muted-foreground) 60%, transparent);
}
.code-scrollbar::-webkit-scrollbar-corner {
  background: transparent;
}
</style>
