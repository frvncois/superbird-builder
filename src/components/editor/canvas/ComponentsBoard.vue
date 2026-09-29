<script setup lang="ts">
// What the canvas shows while the Components column is open: every component
// on one board, grouped by category, each rendered once in its own card and
// editable in place — select an element and the Style / Data / Interactions
// panels edit the component's master. Same infinite canvas as the pages
// (CanvasViewport): scroll to pan, ⌘+scroll or pinch to zoom, space+drag.
//
// Structure is editable too: an edit mutates the component's master and is
// pushed to every instance on every page. Inserting a component INTO a page
// still happens on the page, from the ⌘E dock.
import { computed, nextTick, ref, watch } from 'vue'
import CanvasViewport from '@/components/editor/canvas/CanvasViewport.vue'
import ElementRenderer from '@/components/editor/canvas/ElementRenderer.vue'
import InsertDock from '@/components/editor/canvas/InsertDock.vue'
import { useComponentBoard, useComponentBoardSession } from '@/composables/useComponentBoard'
import type { BoardCard } from '@/composables/useComponentBoard'
import { useElement } from '@/composables/useElement'
import { useSettings } from '@/composables/useSettings'
import { useVariants } from '@/composables/useVariants'
import { useThemeTokens } from '@/composables/useThemeTokens'

void import('@tailwindcss/browser')
useThemeTokens()
useComponentBoardSession()

const { groups, focusRequest, focusedKey } = useComponentBoard()
const { selectElement } = useElement()
const { settings } = useSettings()
const { picksOnBoard, setPreviewPick } = useVariants()

function onPick(card: BoardCard, axis: string, e: Event) {
  setPreviewPick(card.def, axis, (e.target as HTMLSelectElement).value)
}

// cards are far smaller than page frames, so the board opens closer in
const INITIAL_CAMERA = { x: 60, y: 60, zoom: 0.6 }

// page furniture spans the page, so it gets a desktop-width card; everything
// else sits in a narrow one and keeps its natural size
const WIDE_TYPES = ['section', 'header', 'footer', 'main']
const NARROW = 384
const WIDE = 1024
const isWide = (card: BoardCard) => WIDE_TYPES.includes(card.def.root.children[0]?.type ?? '')

// --- focus: a drawer row brings its card into view and selects it ---
const canvas = ref<InstanceType<typeof CanvasViewport>>()
const allCards = computed(() => groups.value.flatMap((g) => g.cards))

watch(
  () => focusRequest.value?.tick,
  async () => {
    const key = focusRequest.value?.key
    if (!key) return
    await nextTick()
    const el = canvas.value?.worldEl?.querySelector(`[data-board-card="${CSS.escape(key)}"]`)
    if (el) canvas.value?.focusElement(el)
    focusedKey.value = key
    // select what the component actually renders, so the panels are ready
    const card = allCards.value.find((c) => c.key === key)
    const first = card?.def.root.children[0]
    if (first) selectElement(first.id)
  },
)

function onBoardClick() {
  selectElement(null)
  focusedKey.value = null
}
</script>

<template>
  <CanvasViewport ref="canvas" :initial="INITIAL_CAMERA" @click="onBoardClick">
    <template #default="{ zoom }">
      <!-- one row per category: an infinite canvas has no edge to wrap at -->
      <div class="flex w-max flex-col gap-24">
        <section v-for="group in groups" :key="group.name" class="flex flex-col gap-6">
          <!-- labels are scaled against the zoom so they stay readable, like
               the page canvas's frame labels -->
          <h2
            class="origin-bottom-left text-xs font-medium tracking-wide text-muted-foreground uppercase select-none"
            :style="{ transform: `scale(${1 / zoom})` }"
          >
            {{ group.name }}
          </h2>
          <div class="flex w-max items-start gap-16">
            <div
              v-for="card in group.cards"
              :key="card.key"
              :data-board-card="card.key"
              class="flex flex-col gap-3"
            >
              <div
                class="flex origin-bottom-left items-center gap-2 text-[10px] whitespace-nowrap text-muted-foreground select-none"
                :style="{ transform: `scale(${1 / zoom})` }"
              >
                <span :class="focusedKey === card.key ? 'font-medium text-foreground' : ''">
                  {{ card.def.name }}
                </span>
                <span v-if="card.preview" class="rounded-full bg-input px-1.5 py-0.5 text-[9px]">
                  Library
                </span>
                <!-- which option of each axis the card is WEARING. View state,
                     never on the component: changing it must not count as an
                     edit, or browsing a library entry would add it. A native
                     select: this label is counter-scaled inside the canvas's
                     transformed world, where SelectUI's own dropdown would be
                     positioned in the wrong space -->
                <label
                  v-for="axis in card.def.variants ?? []"
                  :key="axis.name"
                  class="flex items-center gap-1"
                  @click.stop
                  @pointerdown.stop
                >
                  <span>{{ axis.name }}</span>
                  <select
                    class="rounded-md bg-input px-1 py-0.5 text-[10px] text-foreground outline-none"
                    :data-board-pick="`${card.def.name}:${axis.name}`"
                    :value="picksOnBoard(card.def)[axis.name]"
                    @change="onPick(card, axis.name, $event)"
                  >
                    <option v-for="option in axis.options" :key="option" :value="option">
                      {{ option }}
                    </option>
                  </select>
                </label>
              </div>
              <!-- `contain: layout` makes the card the containing block for
                   position:fixed, so a dialog's overlay covers its own card
                   rather than the whole editor -->
              <div
                data-site-scope
                data-board-card-surface
                class="bg-white text-black shadow-lg"
                :class="isWide(card) ? '' : 'p-6'"
                :style="{
                  width: `${isWide(card) ? WIDE : NARROW}px`,
                  fontFamily: settings.fonts.family || undefined,
                  contain: 'layout',
                }"
                @click.stop="focusedKey = card.key"
              >
                <ElementRenderer :node="card.def.root" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <template #overlay>
      <InsertDock />
    </template>
  </CanvasViewport>
</template>
