<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component as VueComponent } from 'vue'
import { Component, CornerDownLeft, Plus } from 'lucide-vue-next'
import InputUI from '@/components/ui/InputUI.vue'
import { useComponents } from '@/composables/useComponents'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useElement } from '@/composables/useElement'
import { useInsertDrag, type InsertPayload } from '@/composables/useInsertDrag'
import { ELEMENT_GROUPS } from '@/lib/elementPalette'
import { fuzzyScore } from '@/lib/fuzzy'

const { components } = useComponents()
const { open, closePalette, togglePalette, insertElement, insertComponent } = useCommandPalette()
const { requestEditorFocus } = useElement()
const { startInsertDrag } = useInsertDrag()

const query = ref('')
const active = ref(0)
const input = ref<InstanceType<typeof InputUI>>()
const listEl = ref<HTMLElement>()

// keep the focus on the search input, but still reveal the keyboard-active
// card by scrolling the results area to it
function scrollActiveIntoView() {
  nextTick(() =>
    listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }),
  )
}

interface DockItem {
  key: string
  label: string
  keywords: string[]
  icon: VueComponent
  accent: boolean
  payload: InsertPayload
  run: () => void
}

// full item set: built-in elements, then components when present. Each item
// is both a drag source (payload) and a click/Enter action (run).
const allGroups = computed<{ title: string; items: DockItem[] }[]>(() => {
  const base: { title: string; items: DockItem[] }[] = ELEMENT_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.map((item) => ({
      key: item.type,
      label: item.label,
      keywords: [item.type],
      icon: item.icon,
      accent: false,
      payload: { kind: 'element', type: item.type, label: item.label, icon: item.icon },
      run: () => insertElement(item.type),
    })),
  }))
  if (components.value.length) {
    base.push({
      title: 'Components',
      items: components.value.map((c) => ({
        key: `component:${c.id}`,
        label: c.name,
        keywords: [],
        icon: Component,
        accent: true,
        payload: { kind: 'component', name: c.name },
        run: () => insertComponent(c.name),
      })),
    })
  }
  return base
})

// live fuzzy filter; keep a flat list (display order) for keyboard nav
const results = computed(() => {
  const q = query.value.trim()
  const groups: { title: string; items: { item: DockItem; index: number }[] }[] = []
  const flat: DockItem[] = []
  for (const group of allGroups.value) {
    const matched = q
      ? group.items
          .map((item) => {
            const scores = [item.label, ...item.keywords]
              .map((t) => fuzzyScore(q, t))
              .filter((s): s is number => s !== null)
            return scores.length ? { item, score: Math.max(...scores) } : null
          })
          .filter((x): x is { item: DockItem; score: number } => x !== null)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.item)
      : group.items
    if (!matched.length) continue
    groups.push({
      title: group.title,
      items: matched.map((item) => {
        const index = flat.length
        flat.push(item)
        return { item, index }
      }),
    })
  }
  return { groups, flat }
})

watch(query, () => (active.value = 0))
watch(
  () => results.value.flat.length,
  (len) => {
    if (active.value >= len) active.value = Math.max(0, len - 1)
  },
)

// Escape closes the dock from anywhere while it's open — the panel's own
// @keydown misses it once focus has moved to the editor (after an insert)
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
  }
}

// a click anywhere outside the dock (button + panel) closes it
const dockRoot = ref<HTMLElement>()
function onDocClick(e: MouseEvent) {
  if (dockRoot.value && !dockRoot.value.contains(e.target as Node)) closePalette()
}

// focus the search + reset the query each time the panel opens; register the
// global Escape + click-outside listeners only while open
watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    active.value = 0
    nextTick(() => input.value?.focus())
    window.addEventListener('keydown', onWindowKeydown)
    // deferred so the click that opened the dock doesn't immediately close it
    nextTick(() => document.addEventListener('click', onDocClick))
  } else {
    window.removeEventListener('keydown', onWindowKeydown)
    document.removeEventListener('click', onDocClick)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('click', onDocClick)
})

function pick(item: DockItem) {
  item.run() // stays open — add several in a row
  requestEditorFocus() // drop the caret on the new element's line
}

// spatial navigation over the wrapping card grid: from the active card,
// pick the nearest card in the pressed direction (cross-axis weighted so
// it stays aligned to the same row/column)
function navigate(dir: 'up' | 'down' | 'left' | 'right') {
  const container = listEl.value
  if (!container) return
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-idx]'))
  if (!cards.length) return
  const cur = cards.find((c) => Number(c.dataset.idx) === active.value) ?? cards[0]!
  const cr = cur.getBoundingClientRect()
  const cx = cr.left + cr.width / 2
  const cy = cr.top + cr.height / 2

  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const card of cards) {
    if (card === cur) continue
    const r = card.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    let primary: number
    let cross: number
    if (dir === 'right') {
      if (dx <= 1) continue
      primary = dx
      cross = Math.abs(dy)
    } else if (dir === 'left') {
      if (dx >= -1) continue
      primary = -dx
      cross = Math.abs(dy)
    } else if (dir === 'down') {
      if (dy <= 1) continue
      primary = dy
      cross = Math.abs(dx)
    } else {
      if (dy >= -1) continue
      primary = -dy
      cross = Math.abs(dx)
    }
    const score = primary + cross * 2
    if (score < bestScore) {
      bestScore = score
      best = card
    }
  }
  if (best) {
    active.value = Number(best.dataset.idx)
    scrollActiveIntoView()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    navigate('down')
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    navigate('up')
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    navigate('right')
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    navigate('left')
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = results.value.flat[active.value]
    if (item) {
      pick(item)
      closePalette() // keyboard insert commits and closes
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
  }
}
</script>

<template>
  <div ref="dockRoot" class="absolute bottom-1 left-1 z-40 flex max-w-[calc(100%-2rem)] flex-col-reverse items-start gap-2">
    <!-- the + button is the anchor the panel grows out of -->
    <button
      v-tooltip.right="'Insert elements (⌘E)'"
      type="button"
      class="flex size-10 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground shadow-lg transition-all duration-200"
      :class="open ? 'rotate-45' : ''"
      @click="togglePalette"
    >
      <Plus class="size-5" />
    </button>

    <Transition name="dock">
      <div
        v-if="open"
        class="flex w-80 origin-bottom-left flex-col overflow-hidden rounded-2xl border border-input bg-background/96 shadow-xl backdrop-blur"
        @keydown="onKeydown"
      >
        <div class="border-b border-input p-4">
          <div class="dock-search relative">
            <InputUI ref="input" size="lg" v-model="query" placeholder="Search elements & components…" />
            <CornerDownLeft
              class="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>

        <div
          ref="listEl"
          class="dock-scroll flex max-h-64 flex-col gap-2 overflow-y-auto p-4"
          @wheel.stop
        >
          <div v-for="group in results.groups" :key="group.title" class="flex flex-col gap-2">
            <p class="px-0.5 text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
              {{ group.title }}
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="{ item, index } in group.items"
                :key="item.key"
                type="button"
                :data-idx="index"
                :data-active="index === active"
                class="flex aspect-square w-16 shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-1.5 rounded-xl border p-2 transition-colors select-none active:cursor-grabbing"
                :class="
                  index === active
                    ? 'border-accent bg-accent/20'
                    : 'border-input bg-background hover:border-accent hover:bg-accent/10'
                "
                @mousemove="active = index"
                @click="pick(item)"
                @pointerdown.left="startInsertDrag(item.payload, $event)"
              >
                <component
                  :is="item.icon"
                  class="size-4 shrink-0"
                  :class="item.accent ? 'text-success' : 'text-foreground'"
                />
                <span class="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
                  {{ item.label }}
                </span>
              </button>
            </div>
          </div>

          <p v-if="!results.flat.length" class="px-2 py-6 text-center text-xs text-muted-foreground">
            No results
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dock-enter-active,
.dock-leave-active {
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.15s ease;
}
.dock-enter-from,
.dock-leave-to {
  transform: scale(0.9) translateY(6px);
  opacity: 0;
}

/* leave room for the ↵ hint so the query text never slides under it */
.dock-search :deep(input) {
  padding-right: 2rem;
}
</style>
