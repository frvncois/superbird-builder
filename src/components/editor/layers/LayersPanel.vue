<script setup lang="ts">
// The Layers column: the element tree of whatever the canvas is showing.
//
// It replaces the code editor. The DSL only ever carried an element's type,
// nesting, ref, binding and link — everything else (classes, content, media,
// interactions, translations) lives on the node and is edited in the panels —
// so this shows the same structure without the text round-trip.
import { computed, ref, watch } from 'vue'
import { useElement } from '@/composables/useElement'
import { usePage } from '@/composables/usePage'
import { useStructure } from '@/composables/useStructure'
import { useDrawerEscape } from '@/composables/useDrawerEscape'
import { findNode } from '@/lib/tree'
import LayerRow from './LayerRow.vue'
import { useLayerState } from './layerState'
import type { ElementNode } from '@/types/editor'

const { activePage } = usePage()
const { selectedElement } = useElement()
const { backend } = useStructure()
const { reveal } = useLayerState()

const roots = computed(() => backend.value.roots.value)
const title = computed(() => activePage.value?.name ?? 'Layers')

const panel = ref<HTMLElement>()

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
    panel.value
      ?.querySelector(`[data-layer-row="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)

useDrawerEscape(panel, { canPeel: () => false, peel: () => {} })
</script>

<template>
  <div ref="panel" class="flex h-full flex-col bg-background">
    <!-- h-11 matches the other columns' search row, so switching between them
         moves nothing below it -->
    <div class="flex h-11 shrink-0 items-center gap-1 px-2.5">
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ title }}</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-8">
      <LayerRow v-for="node in roots" :key="node.id" :node="node" :depth="0" />
      <p v-if="!roots.length" class="px-2 py-6 text-center text-xs text-muted-foreground">
        Nothing here yet.
      </p>
    </div>
  </div>
</template>
