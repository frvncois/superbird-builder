<script setup lang="ts">
// Pages/collections navigator opened from the left rail — an overlay panel
// covering the CodeEditor pane. Three zones: a search field, the scrollable
// Pages + Collections tree, and the locale switcher pinned at the bottom.
// Row overflow actions (settings/duplicate/delete) live in a per-row kebab.
import { computed, ref, watch, onBeforeUnmount, onMounted } from 'vue'
import {
  Plus, Copy, Trash2, Settings, Languages, ChevronDown, ChevronRight, Check,
  House, Search, Layers,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import PageSettingsEditor, { type SettingsTarget } from './PageSettingsEditor.vue'
import CreateCollectionModal from '@/components/shared/CreateCollectionModal.vue'
import { usePage } from '@/composables/usePage'
import { useProject } from '@/composables/useProject'
import { useCollections } from '@/composables/useCollections'
import { useHeaderNav } from '@/composables/useHeaderNav'
import { useLocale } from '@/composables/useLocale'
import { useLocaleQuickAdd } from '@/composables/useLocaleQuickAdd'
import { useModal } from '@/composables/useModal'
import { walkNodes } from '@/lib/tree'
import type { Collection, CollectionEntry, ElementNode, Page } from '@/types/editor'

// kept mounted by the parent; `open` drives the slide/fade transitions so the
// leave animation can play out (a parent v-if would unmount before it runs)
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { homePage, duplicatePage, removePage } = usePage()
const {
  collections, duplicateEntry, removeEntry,
  duplicateCollection, removeCollection, openEntry, activeEntryId,
} = useCollections()
const { regularPages, isActivePage, openPage, createPage, newEntry } = useHeaderNav()
const { project } = useProject()
const { locales, activeLocale, defaultLocale, setActiveLocale, deleteLocale } = useLocale()
const {
  addingLocale, newLocale, newLocaleInput,
  startAddLocale, confirmAddLocale,
} = useLocaleQuickAdd()
const { openModal, confirm } = useModal()

// when set, the drawer swaps its list for the page/item settings panel
const settingsTarget = ref<SettingsTarget | null>(null)
// name filter across pages, collections and entries
const query = ref('')
// per-collection expand state — the drawer stays mounted between opens, so a
// plain ref keeps the tree as the user left it for the session
const expanded = ref<Record<string, boolean>>({})

watch(
  () => props.open,
  (o) => {
    if (!o) {
      // closing discards the settings view and the filter so it reopens clean
      settingsTarget.value = null
      query.value = ''
      return
    }
    // reveal the entry being edited rather than making the user hunt for it
    if (!activeEntryId.value) return
    const owner = collections.value.find((c) =>
      c.entries.some((e) => e.id === activeEntryId.value),
    )
    if (owner) expanded.value[owner.id] = true
  },
)

// --- filtering ---
const needle = computed(() => query.value.trim().toLowerCase())
const searching = computed(() => needle.value.length > 0)
const matches = (name: string) => name.toLowerCase().includes(needle.value)

const visiblePages = computed<Page[]>(() =>
  searching.value ? regularPages.value.filter((p) => matches(p.name)) : regularPages.value,
)

/** collections to render, each with the entries that survive the filter —
 * a collection whose own name matches keeps all of its entries */
const visibleCollections = computed<{ collection: Collection; entries: CollectionEntry[] }[]>(() => {
  if (!searching.value) return collections.value.map((c) => ({ collection: c, entries: c.entries }))
  const out: { collection: Collection; entries: CollectionEntry[] }[] = []
  for (const collection of collections.value) {
    if (matches(collection.name)) {
      out.push({ collection, entries: collection.entries })
      continue
    }
    const entries = collection.entries.filter((e) => matches(e.name))
    if (entries.length) out.push({ collection, entries })
  }
  return out
})

const noResults = computed(
  () => searching.value && !visiblePages.value.length && !visibleCollections.value.length,
)

// while filtering every group is forced open (without touching the stored state)
const isExpanded = (id: string) => searching.value || expanded.value[id] === true
const toggleCollection = (id: string) => {
  if (searching.value) return
  expanded.value[id] = !expanded.value[id]
}

const isDraft = (status?: string) => status === 'draft'

function go(fn: () => void) {
  fn()
  emit('close')
}

// --- locale detail: human name + translation coverage per locale ---
// There is no per-locale publish state in the model; "coverage" is the number
// of nodes/entry-fields carrying an override for that locale (the default
// locale holds the base/source content, so it has no overrides to count).
const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()
function localeName(code: string): string {
  try {
    return languageNames?.of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const localeStats = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  const bump = (code: string) => (counts[code] = (counts[code] ?? 0) + 1)
  const countNode = (node: ElementNode) => {
    if (!node.locales) return
    for (const [code, v] of Object.entries(node.locales)) {
      if (v && (v.content != null || v.src != null)) bump(code)
    }
  }
  for (const page of project.value.pages) walkNodes(page.elements, countNode)
  for (const comp of project.value.components) walkNodes([comp.root], countNode)
  for (const collection of project.value.collections) {
    for (const entry of collection.entries) {
      if (!entry.locales) continue
      for (const [code, fields] of Object.entries(entry.locales)) {
        for (const val of Object.values(fields)) if (val != null && val !== '') bump(code)
      }
    }
  }
  return counts
})

/** the muted second line under a locale name: "EN · Default · source" etc. */
function localeMeta(code: string): string {
  const parts = [code.toUpperCase()]
  if (code === defaultLocale.value) {
    parts.push('Default', 'source content')
  } else {
    const n = localeStats.value[code] ?? 0
    parts.push(n ? `${n} translated` : 'Not translated')
  }
  return parts.join(' · ')
}

function pickLocale(code: string, close: () => void) {
  setActiveLocale(code)
  addingLocale.value = false
  close()
}

// --- destructive actions (all confirmed) ---
async function confirmDeletePage(page: Page) {
  const ok = await confirm({
    title: 'Delete page',
    message: `Delete “${page.name}”? This can’t be undone.`,
    confirmLabel: 'Delete',
  })
  if (ok) removePage(page.id)
}

async function confirmDeleteCollection(collection: Collection) {
  const n = collection.entries.length
  const ok = await confirm({
    title: 'Delete collection',
    message: `Delete the collection “${collection.name}”? Its template page and all ${n} ${n === 1 ? 'entry' : 'entries'} will be permanently deleted.`,
  })
  if (ok) removeCollection(collection)
}

async function confirmDeleteEntry(collection: Collection, entry: CollectionEntry) {
  const ok = await confirm({
    title: 'Delete entry',
    message: `Delete “${entry.name}” from ${collection.name}? This can’t be undone.`,
  })
  if (ok) removeEntry(collection, entry.id)
}

async function confirmDeleteLocale(loc: string) {
  const ok = await confirm({
    title: 'Delete locale',
    message: `Delete ${loc.toUpperCase()} and all of its translated content? The default locale keeps its content.`,
  })
  if (ok) deleteLocale(loc)
}

const panel = ref<HTMLElement>()

// Capture-phase Escape so the drawer closes before SettingsEditor's
// window handler (bubble phase) pulls focus back to the code editor.
function onKeydownCapture(e: KeyboardEvent) {
  if (!props.open || e.key !== 'Escape') return
  // an open row kebab owns Escape first — let it bubble to MenuUI's own handler
  if (panel.value?.querySelector('[data-open]')) return
  e.stopPropagation()
  // peel back one layer at a time: filter → settings view → the drawer itself
  if (searching.value) query.value = ''
  else if (settingsTarget.value) settingsTarget.value = null
  else emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydownCapture, true))
</script>

<template>
  <!-- backdrop: outside click closes -->
  <Transition name="drawer-backdrop">
    <div v-if="open" class="fixed inset-0 z-40" @click="emit('close')" @contextmenu.prevent="emit('close')" />
  </Transition>

  <Transition name="drawer-panel">
  <div
    v-if="open"
    ref="panel"
    class="fixed top-0 left-12 z-50 flex h-full w-64 flex-col border-r border-input bg-background"
  >
    <div v-if="settingsTarget" class="flex-1 overflow-y-auto">
      <PageSettingsEditor
        :target="settingsTarget"
        @back="settingsTarget = null"
        @close="emit('close')"
      />
    </div>

    <template v-else>
    <!-- search -->
    <div class="relative shrink-0 p-1.5">
      <Search class="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        v-model="query"
        type="text"
        spellcheck="false"
        placeholder="Search pages, items…"
        class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
      />
    </div>

    <!-- tree: pb leaves room for a row kebab opened near the bottom -->
    <div class="flex-1 overflow-y-auto pb-10">
      <!-- pages -->
      <div v-if="visiblePages.length || !searching" class="flex items-center gap-1 px-2.5 pt-2 pb-1">
        <span class="flex-1 text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
          Pages
        </span>
        <ButtonUI
          variant="icon" size="xs" :icon="Plus"
          tooltip="New page" tooltip-side="right"
          class="w-5 text-muted-foreground"
          @click.stop="go(createPage)"
        />
      </div>
      <div
        v-for="page in visiblePages" :key="page.id"
        class="group/row mx-1 flex h-7 items-center rounded-lg pr-0.5 pl-1.5"
        :class="isActivePage(page.id) ? 'bg-accent/25' : 'hover:bg-accent/15'"
      >
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
          @click="go(() => openPage(page.id))"
        >
          <House v-if="page.id === homePage.id" class="size-3 shrink-0 text-muted-foreground" />
          <span
            class="truncate text-xs"
            :class="isActivePage(page.id) ? 'font-medium' : 'text-muted-foreground'"
          >{{ page.name }}</span>
          <span
            v-if="isDraft(page.status)"
            v-tooltip="'Draft — not published'"
            class="size-1.5 shrink-0 rounded-full bg-pending"
          />
        </button>
        <MenuUI
          width="w-40"
          class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
          trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <template #default="{ close }">
            <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(settingsTarget = { kind: 'page', pageId: page.id }, close())">
              <Settings class="size-3.5" /> Settings
            </button>
            <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicatePage(page.id), close())">
              <Copy class="size-3.5" /> Duplicate
            </button>
            <template v-if="page.id !== homePage.id">
              <div class="mx-1 my-1 h-px bg-input" />
              <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30 text-danger" @click="(confirmDeletePage(page), close())">
                <Trash2 class="size-3.5" /> Delete
              </button>
            </template>
          </template>
        </MenuUI>
      </div>

      <!-- collections -->
      <div v-if="visibleCollections.length || !searching" class="flex items-center gap-1 px-2.5 pt-4 pb-1">
        <span class="flex-1 text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
          Collections
        </span>
        <ButtonUI
          variant="icon" size="xs" :icon="Plus"
          tooltip="New collection" tooltip-side="right"
          class="w-5 text-muted-foreground"
          @click.stop="go(() => openModal(CreateCollectionModal))"
        />
      </div>
      <p v-if="!collections.length" class="px-2.5 py-1 text-[10px] text-muted-foreground">
        No collections yet.
      </p>

      <div v-for="{ collection, entries } in visibleCollections" :key="collection.id">
        <div class="group/row mx-1 flex h-7 items-center rounded-lg pr-0.5 pl-1 hover:bg-accent/15">
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none"
            @click="toggleCollection(collection.id)"
          >
            <ChevronRight
              class="size-3 shrink-0 text-muted-foreground transition-transform"
              :class="isExpanded(collection.id) && 'rotate-90'"
            />
            <span class="truncate text-xs font-medium">{{ collection.name }}</span>
            <span class="shrink-0 text-[10px] text-muted-foreground">{{ collection.entries.length }}</span>
          </button>
          <ButtonUI
            variant="icon" size="xs" :icon="Plus" tooltip="Add item"
            class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
            @click.stop="go(() => newEntry(collection))"
          />
          <MenuUI
            width="w-44"
            class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
            trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <template #default="{ close }">
              <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(close(), go(() => openPage(collection.templatePageId)))">
                <Layers class="size-3.5" /> Edit template
              </button>
              <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicateCollection(collection), close())">
                <Copy class="size-3.5" /> Duplicate
              </button>
              <div class="mx-1 my-1 h-px bg-input" />
              <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30 text-danger" @click="(confirmDeleteCollection(collection), close())">
                <Trash2 class="size-3.5" /> Delete
              </button>
            </template>
          </MenuUI>
        </div>

        <!-- entries: a guide line carries the nesting at this width -->
        <div v-if="isExpanded(collection.id)" class="mt-0.5 mb-1 ml-3.5 border-l border-input pl-1">
          <p v-if="!entries.length" class="px-1.5 py-1 text-[10px] text-muted-foreground">
            No items yet.
          </p>
          <div
            v-for="entry in entries" :key="entry.id"
            class="group/row mr-1 flex h-7 items-center rounded-lg pr-0.5 pl-1.5"
            :class="activeEntryId === entry.id ? 'bg-accent/25' : 'hover:bg-accent/15'"
          >
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
              @click="go(() => openEntry(collection, entry.id))"
            >
              <span
                class="truncate text-xs"
                :class="activeEntryId === entry.id ? 'font-medium' : 'text-muted-foreground'"
              >{{ entry.name }}</span>
              <span
                v-if="isDraft(entry.status)"
                v-tooltip="'Draft — not published'"
                class="size-1.5 shrink-0 rounded-full bg-pending"
              />
            </button>
            <MenuUI
              width="w-40"
              class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
              trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <template #default="{ close }">
                <button
                  type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
                  @click="(settingsTarget = { kind: 'entry', collectionId: collection.id, entryId: entry.id }, close())"
                >
                  <Settings class="size-3.5" /> Settings
                </button>
                <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicateEntry(collection, entry.id), close())">
                  <Copy class="size-3.5" /> Duplicate
                </button>
                <div class="mx-1 my-1 h-px bg-input" />
                <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30 text-danger" @click="(confirmDeleteEntry(collection, entry), close())">
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

    <!-- locale switcher: pinned, opens upward -->
    <div class="shrink-0 border-t border-input p-1">
      <MenuUI
        side="top"
        width="w-[15rem]"
        trigger-class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <template #trigger>
          <Languages class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-xs font-medium">{{ localeName(activeLocale) }}</span>
            <span class="truncate text-[10px] text-muted-foreground">{{ localeMeta(activeLocale) }}</span>
          </span>
          <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
        </template>
        <template #default="{ close }">
          <div v-for="loc in locales" :key="loc" class="group/loc flex items-center">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
              @click="pickLocale(loc, close)"
            >
              <Check class="mt-0.5 size-3 shrink-0" :class="loc === activeLocale ? 'opacity-100' : 'opacity-0'" />
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-xs font-medium">{{ localeName(loc) }}</span>
                <span class="truncate text-[10px] text-muted-foreground">{{ localeMeta(loc) }}</span>
              </span>
            </button>
            <ButtonUI
              v-if="loc !== defaultLocale"
              variant="icon" size="sm" :icon="Trash2" tooltip="Delete locale"
              class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/loc:opacity-100 hover:text-danger"
              @click.stop="confirmDeleteLocale(loc)"
            />
          </div>
          <div class="mx-1 my-1 h-px bg-input" />
          <ButtonUI
            v-if="!addingLocale"
            variant="ghost" size="sm" :icon="Plus"
            class="w-full justify-start text-muted-foreground"
            @click.stop="startAddLocale"
          >
            Add locale…
          </ButtonUI>
          <input
            v-else
            ref="newLocaleInput"
            v-model="newLocale"
            class="mx-1 my-0.5 w-[calc(100%-0.5rem)] rounded border border-input bg-transparent px-2 py-1 text-xs text-foreground outline-none"
            placeholder="e.g. fr"
            @click.stop
            @keydown.enter.prevent="confirmAddLocale(() => {})"
            @keydown.esc.stop.prevent="addingLocale = false"
          />
        </template>
      </MenuUI>
    </div>
    </template>
  </div>
  </Transition>
</template>

<style scoped>
.drawer-panel-enter-active,
.drawer-panel-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.drawer-panel-enter-from,
.drawer-panel-leave-to {
  transform: translateX(-100%);
}

.drawer-backdrop-enter-active,
.drawer-backdrop-leave-active {
  transition: opacity 0.25s ease;
}
.drawer-backdrop-enter-from,
.drawer-backdrop-leave-to {
  opacity: 0;
}
</style>
