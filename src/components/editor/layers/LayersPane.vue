<script setup lang="ts">
// The Layers view: the element tree of the page on the canvas, and the surface
// its structure is authored on. Opened from a page's (or a collection
// template's) Edit icon in the Pages drawer, which swaps its list for this.
//
// The DSL only ever carried an element's type, nesting, ref, binding and link —
// everything else (classes, content, media, interactions, translations) lives
// on the node and is edited in the panels — so this shows the same structure
// without a text round-trip.
import { computed, ref } from 'vue'
import { ChevronLeft, TriangleAlert } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useElement } from '@/composables/useElement'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useComponents } from '@/composables/useComponents'
import { useStructure } from '@/composables/useStructure'
import { validateDocument } from '@/lib/syntax'
import LayerRow from './LayerRow.vue'
import { useLayerSurface } from './useLayerSurface'

const emit = defineEmits<{ back: [] }>()

const { activePage } = usePage()
const { collections } = useCollections()
const { components } = useComponents()
const { selectElement, elementAtLine } = useElement()
const { backend } = useStructure()

const roots = computed(() => backend.value.roots.value)
const isPage = computed(() => backend.value.kind === 'page')
const title = computed(() => activePage.value?.name ?? 'Layers')

const surface = ref<HTMLElement>()
const { onKeydown } = useLayerSurface({
  surface,
  roots: () => roots.value,
  canRename: () => isPage.value,
})

// --- issues: the only place a human sees that a document is broken ---
// (they still arrive from agents, merges and older projects)

const issues = computed(() => {
  const page = activePage.value
  if (!isPage.value || !page) return []
  return validateDocument(
    page.code,
    components.value.map((c) => c.name),
    collections.value.map((c) => c.name),
    collections.value.flatMap((c) =>
      c.fields
        .filter((f) => f.type === 'multi-reference' || f.type === 'multi-image')
        .map((f) => f.name),
    ),
    collections.value.filter((c) => c.detailRoutes === false).map((c) => c.name),
  )
})

function goToIssue(line: number) {
  const node = elementAtLine(line)
  if (node) selectElement(node.id)
}
</script>

<template>
  <div
    ref="surface"
    data-insert-surface
    class="flex h-full flex-col outline-none"
    tabindex="0"
    @keydown="onKeydown"
  >
    <!-- h-11 matches the list view's search row, so swapping between the two
         states moves nothing below it -->
    <div class="flex h-11 shrink-0 items-center gap-1 px-1.5">
      <ButtonUI
        variant="icon"
        size="sm"
        :icon="ChevronLeft"
        tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="emit('back')"
      />
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ title }}</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-8">
      <LayerRow v-for="node in roots" :key="node.id" :node="node" :depth="0" />
      <p v-if="!roots.length" class="px-2 py-6 text-center text-xs text-muted-foreground">
        Nothing here yet.
      </p>
    </div>

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
