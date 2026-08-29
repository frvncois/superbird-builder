<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import DocSidebar from '@/components/docs/DocSidebar.vue'
import DocCard from '@/components/docs/DocCard.vue'
import DocKbd from '@/components/docs/DocKbd.vue'
import DocCallout from '@/components/docs/DocCallout.vue'
import DocSteps from '@/components/docs/DocSteps.vue'
import DocCodePreview from '@/components/docs/DocCodePreview.vue'
import DocOutline from '@/components/docs/DocOutline.vue'
import { useDocumentation } from '@/composables/useDocumentation'
import {
  DOC_GROUPS,
  DOC_SECTIONS,
  docFindAnchor,
  docHeadingId,
  docHeadings,
  docSectionMatches,
} from '@/lib/docs'

defineEmits<{ close: [] }>()

const { activeSection } = useDocumentation()

const query = ref('')
const section = computed(() => DOC_SECTIONS.find((s) => s.id === activeSection.value) ?? null)
const headings = computed(() => (section.value ? docHeadings(section.value) : []))
const sectionsIn = (group: string) => DOC_SECTIONS.filter((s) => s.group === group)

const scrollArea = ref<HTMLElement>()
const activeHeading = ref<string | null>(null)

function jumpTo(anchor: string) {
  activeHeading.value = anchor
  document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function navigate(id: string | null, anchor?: string | null) {
  activeSection.value = id
  query.value = ''
  activeHeading.value = anchor ?? null
  nextTick(() => {
    if (anchor) jumpTo(anchor)
    else scrollArea.value?.scrollTo({ top: 0 })
  })
}

// Enter while searching jumps to the best match — and to the matching heading
// inside it when the hit was a heading or shortcut name
function jumpToFirstMatch() {
  const q = query.value.trim()
  if (!q) return
  const hit = DOC_SECTIONS.find((s) => docSectionMatches(s, q))
  if (hit) navigate(hit.id, docFindAnchor(hit, q))
}

watch(activeSection, () => {
  if (!activeHeading.value) scrollArea.value?.scrollTo({ top: 0 })
})
</script>

<template>
  <ModalHost size="full" @close="$emit('close')">
    <div class="flex h-full flex-col">
      <!-- top bar -->
      <div class="flex shrink-0 items-center gap-3 border-b border-input px-4 py-2.5">
        <div class="relative w-64">
          <Search
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            v-model="query"
            type="text"
            spellcheck="false"
            placeholder="Search documentation…"
            class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
            @keydown.enter="jumpToFirstMatch"
          />
        </div>
        <div class="flex-1" />
        <ButtonUI variant="ghost" :icon="X" class="w-7 text-muted-foreground" @click="$emit('close')" />
      </div>

      <div class="flex min-h-0 flex-1">
        <DocSidebar :active="activeSection" :filter="query" @navigate="navigate($event)" />

        <div ref="scrollArea" class="min-w-0 flex-1 scroll-pt-8 overflow-y-auto">
          <!-- hub / home -->
          <div v-if="!section" class="mx-auto flex max-w-3xl flex-col gap-10 p-8 lg:p-10">
            <div class="flex flex-col gap-2">
              <h1 class="text-2xl font-semibold text-foreground">Welcome to Superbird</h1>
              <p class="max-w-xl text-sm leading-6 text-muted-foreground">
                Build websites visually with a simple, readable syntax. Write structure in the
                code editor, watch it render live on the canvas, and style, translate, and
                publish — all in one place.
              </p>
            </div>

            <div v-for="group in DOC_GROUPS" :key="group" class="flex flex-col gap-3">
              <h2 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {{ group }}
              </h2>
              <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <DocCard
                  v-for="s in sectionsIn(group)"
                  :key="s.id"
                  :icon="s.icon"
                  :title="s.title"
                  :lead="s.lead"
                  @select="navigate(s.id)"
                />
              </div>
            </div>
          </div>

          <!-- section article -->
          <div v-else class="flex justify-center gap-10 p-8 lg:p-10">
            <article class="flex min-w-0 max-w-2xl flex-1 flex-col gap-7">
              <div class="flex flex-col gap-3">
                <span
                  class="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
                >
                  <component :is="section.icon" class="size-4.5" />
                </span>
                <h1 class="text-2xl font-semibold text-foreground">{{ section.title }}</h1>
                <p class="text-sm leading-6 text-muted-foreground">{{ section.lead }}</p>
              </div>

              <template v-for="(block, i) in section.blocks" :key="i">
                <!-- anchorable sub-heading -->
                <h2
                  v-if="block.kind === 'heading'"
                  :id="docHeadingId(section.id, block.text)"
                  class="mt-2 scroll-mt-8 text-base font-medium text-foreground"
                >
                  {{ block.text }}
                </h2>

                <!-- paragraph -->
                <p v-else-if="block.kind === 'p'" class="text-sm leading-6 text-muted-foreground">
                  {{ block.text }}
                </p>

                <!-- keyboard rows -->
                <div v-else-if="block.kind === 'keys'" class="flex flex-col rounded-xl border border-input">
                  <div
                    v-for="row in block.rows"
                    :key="row.does"
                    class="flex items-center justify-between gap-4 border-b border-input px-4 py-2.5 last:border-b-0"
                  >
                    <span class="text-sm text-muted-foreground">{{ row.does }}</span>
                    <span class="flex shrink-0 items-center gap-1">
                      <DocKbd v-for="key in row.keys" :key="key">{{ key }}</DocKbd>
                    </span>
                  </div>
                </div>

                <!-- definition rows -->
                <div v-else-if="block.kind === 'defs'" class="flex flex-col rounded-xl border border-input">
                  <div
                    v-for="row in block.rows"
                    :key="row.term"
                    class="flex flex-col gap-1 border-b border-input px-4 py-3 last:border-b-0"
                  >
                    <span class="font-mono text-xs text-foreground">{{ row.term }}</span>
                    <span class="text-sm leading-6 text-muted-foreground">{{ row.text }}</span>
                  </div>
                </div>

                <!-- plain code example -->
                <div v-else-if="block.kind === 'code'" class="flex flex-col gap-1.5">
                  <pre
                    class="rounded-xl border border-input bg-muted/40 px-4 py-3 font-mono text-xs leading-5 whitespace-pre tab-2"
                    :class="block.component ? 'text-success' : 'text-foreground'"
                    >{{ block.lines.join('\n') }}</pre
                  >
                  <p v-if="block.caption" class="px-1 text-xs text-muted-foreground">
                    {{ block.caption }}
                  </p>
                </div>

                <!-- code + rendered preview -->
                <DocCodePreview
                  v-else-if="block.kind === 'codePreview'"
                  :lines="block.lines"
                  :preview="block.preview"
                  :caption="block.caption"
                  :component="block.component"
                />

                <!-- numbered steps -->
                <DocSteps v-else-if="block.kind === 'steps'" :steps="block.steps" />

                <!-- callout -->
                <DocCallout
                  v-else-if="block.kind === 'callout'"
                  :tone="block.tone"
                  :text="block.text"
                />

                <!-- bullet list -->
                <ul v-else-if="block.kind === 'list'" class="flex flex-col gap-1.5">
                  <li
                    v-for="item in block.items"
                    :key="item"
                    class="flex gap-2 text-sm leading-6 text-muted-foreground"
                  >
                    <span class="shrink-0 text-muted-foreground/60">•</span>
                    <span>{{ item }}</span>
                  </li>
                </ul>
              </template>
            </article>

            <DocOutline
              v-if="headings.length >= 2"
              :headings="headings"
              :active="activeHeading"
              @jump="jumpTo"
            />
          </div>
        </div>
      </div>
    </div>
  </ModalHost>
</template>
