<script lang="ts">
import { ref } from 'vue'

// per-category expand state — module-level because the column unmounts when
// it is toggled off, and the tree should come back as the user left it
const expanded = ref<Record<string, boolean>>({})
</script>

<script setup lang="ts">
// Components navigator toggled from the left rail — a docked column sharing
// the one track beside the rail with Pages and the code editor. It lists the
// project's own components, grouped by category: click a row to insert it at
// the selection, drag it onto the canvas, or open its settings from the kebab.
import { computed } from 'vue'
import { ChevronRight, Component as ComponentIcon, Copy, Search, Settings, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import ComponentSettingsEditor from './ComponentSettingsEditor.vue'
import { useComponents } from '@/composables/useComponents'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useInsertDrag } from '@/composables/useInsertDrag'
import { useElement } from '@/composables/useElement'
import { useDrawerEscape } from '@/composables/useDrawerEscape'
import { useModal } from '@/composables/useModal'
import type { ComponentDef } from '@/types/editor'

const { components, duplicateComponent, usageOf, deleteComponent } = useComponents()
const { insertComponent } = useCommandPalette()
const { startInsertDrag } = useInsertDrag()
const { requestEditorFocus } = useElement()
const { confirm } = useModal()

/** when set, the drawer swaps its list for that component's settings */
const settingsId = ref<string | null>(null)
const query = ref('')

const UNCATEGORIZED = 'Uncategorized'

// --- filtering ---
const needle = computed(() => query.value.trim().toLowerCase())
const searching = computed(() => needle.value.length > 0)
const matches = (name: string) => name.toLowerCase().includes(needle.value)

/** components by category, alphabetical, with Uncategorized always last —
 * a category whose own name matches the filter keeps all of its components */
const groups = computed<{ name: string; items: ComponentDef[] }[]>(() => {
  const byCategory = new Map<string, ComponentDef[]>()
  for (const c of components.value) {
    const category = c.category?.trim() || UNCATEGORIZED
    const keepAll = searching.value && matches(category)
    if (searching.value && !keepAll && !matches(c.name)) continue
    const list = byCategory.get(category)
    if (list) list.push(c)
    else byCategory.set(category, [c])
  }
  return [...byCategory.entries()]
    .map(([name, items]) => ({ name, items: [...items].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => {
      if (a.name === UNCATEGORIZED) return 1
      if (b.name === UNCATEGORIZED) return -1
      return a.name.localeCompare(b.name)
    })
})

const noResults = computed(() => searching.value && !groups.value.length)

// while filtering every group is forced open (without touching the stored state)
const isExpanded = (name: string) => searching.value || expanded.value[name] !== false
const toggleGroup = (name: string) => {
  if (searching.value) return
  expanded.value[name] = expanded.value[name] === false
}

// --- row actions ---
/** click inserts at the current selection, like the ⌘E dock's cards */
function onInsert(name: string) {
  insertComponent(name)
  requestEditorFocus()
}

async function confirmDelete(def: ComponentDef) {
  const used = usageOf(def.name)
  const ok = await confirm({
    title: 'Delete component',
    message: used.count
      ? `Delete “${def.name}”? Its ${used.count === 1 ? 'instance' : `${used.count} instances`} stay on the page as plain elements, keeping their look.`
      : `Delete “${def.name}”? It isn’t used on any page.`,
    confirmLabel: 'Delete',
  })
  if (ok) deleteComponent(def.id)
}

const panel = ref<HTMLElement>()

// Escape peels one layer at a time — filter, then the settings view — and
// never closes the column itself; only the rail does.
useDrawerEscape(panel, {
  canPeel: () => searching.value || !!settingsId.value,
  peel: () => {
    if (searching.value) query.value = ''
    else settingsId.value = null
  },
})
</script>

<template>
  <div ref="panel" class="flex h-full flex-col bg-background">
    <!-- list and settings are two layers of one surface, so they swap with a
         transform-only push rather than a hard cut (same as PagesDrawer) -->
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <Transition name="drawer-push">
        <div v-if="settingsId" class="pane pane-settings overflow-y-auto">
          <ComponentSettingsEditor :component-id="settingsId" @back="settingsId = null" />
        </div>

        <div v-else class="pane pane-list flex flex-col">
          <!-- search -->
          <div class="relative shrink-0 p-1.5">
            <Search class="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="query"
              type="text"
              spellcheck="false"
              placeholder="Search components…"
              class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <!-- tree: pb leaves room for a row kebab opened near the bottom -->
          <div class="flex-1 overflow-y-auto pb-10">
            <div class="flex items-center gap-1 px-2.5 pt-2 pb-1">
              <span class="flex-1 text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
                Project
              </span>
            </div>

            <p v-if="!components.length" class="px-2.5 py-1 text-[10px] text-muted-foreground">
              No components yet. Select an element on the canvas and choose “Create component”.
            </p>

            <div v-for="group in groups" :key="group.name">
              <div class="group/row mx-1 flex h-7 items-center rounded-lg pr-0.5 pl-1 hover:bg-accent/15">
                <button
                  type="button"
                  class="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none"
                  @click="toggleGroup(group.name)"
                >
                  <ChevronRight
                    class="size-3 shrink-0 text-muted-foreground transition-transform"
                    :class="isExpanded(group.name) && 'rotate-90'"
                  />
                  <span class="truncate text-xs font-medium">{{ group.name }}</span>
                  <span class="shrink-0 text-[10px] text-muted-foreground">{{ group.items.length }}</span>
                </button>
              </div>

              <!-- a guide line carries the nesting at this width -->
              <div v-if="isExpanded(group.name)" class="mt-0.5 mb-1 ml-3.5 border-l border-input pl-1">
                <div
                  v-for="def in group.items"
                  :key="def.id"
                  class="group/row mr-1 flex h-7 items-center rounded-lg pr-0.5 pl-1.5 hover:bg-accent/15"
                >
                  <!-- click inserts, drag drops onto the canvas: the same two
                       affordances the ⌘E dock's cards carry, so touch-action
                       has to be off for the pointer capture to work -->
                  <button
                    type="button"
                    class="flex h-full min-w-0 flex-1 cursor-grab touch-none items-center gap-1.5 text-left outline-none select-none active:cursor-grabbing"
                    @click="onInsert(def.name)"
                    @pointerdown.left="startInsertDrag({ kind: 'component', name: def.name }, $event)"
                  >
                    <ComponentIcon class="size-3 shrink-0 text-muted-foreground" />
                    <span class="truncate text-xs text-muted-foreground">{{ def.name }}</span>
                  </button>
                  <MenuUI
                    width="w-40"
                    class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
                    trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <template #default="{ close }">
                      <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(settingsId = def.id, close())">
                        <Settings class="size-3.5" /> Settings
                      </button>
                      <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicateComponent(def.id), close())">
                        <Copy class="size-3.5" /> Duplicate
                      </button>
                      <div class="mx-1 my-1 h-px bg-input" />
                      <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(confirmDelete(def), close())">
                        <Trash2 class="size-3.5" /> Delete
                      </button>
                    </template>
                  </MenuUI>
                </div>
              </div>
            </div>

            <p v-if="noResults" class="px-2 py-6 text-center text-xs text-muted-foreground">
              No results for “{{ query.trim() }}”.
            </p>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* the two swap layers stack rather than displace each other */
.pane {
  position: absolute;
  inset: 0;
}
.drawer-push-enter-active,
.drawer-push-leave-active {
  transition:
    transform 0.18s ease-out,
    opacity 0.18s ease-out;
}
/* settings is the deeper layer: it arrives from and leaves to the right */
.pane-settings.drawer-push-enter-from,
.pane-settings.drawer-push-leave-to {
  transform: translateX(0.75rem);
  opacity: 0;
}
.pane-list.drawer-push-enter-from,
.pane-list.drawer-push-leave-to {
  transform: translateX(-0.75rem);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .drawer-push-enter-active,
  .drawer-push-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
