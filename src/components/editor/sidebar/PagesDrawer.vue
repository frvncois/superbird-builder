<script setup lang="ts">
// Pages/collections navigator opened from the left rail — an overlay panel
// covering the CodeEditor pane. Mirrors the old AppHeader page dropdown
// (which Preview still uses) plus the locale switcher at the bottom.
import { onBeforeUnmount, onMounted } from 'vue'
import {
  Plus, Layers, FileText, File, Files, Copy, Trash2, Languages,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import CreateCollectionModal from '@/components/shared/CreateCollectionModal.vue'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useHeaderNav } from '@/composables/useHeaderNav'
import { useLocale } from '@/composables/useLocale'
import { useLocaleQuickAdd } from '@/composables/useLocaleQuickAdd'
import { useModal } from '@/composables/useModal'
import type { Collection, CollectionEntry } from '@/types/editor'

const emit = defineEmits<{ close: [] }>()

const { homePage, duplicatePage, removePage } = usePage()
const {
  collections, duplicateEntry, removeEntry,
  duplicateCollection, removeCollection, openEntry, activeEntryId,
} = useCollections()
const { regularPages, isActivePage, openPage, createPage, newEntry } = useHeaderNav()
const { locales, activeLocale, defaultLocale, setActiveLocale, deleteLocale } = useLocale()
const {
  addingLocale, newLocale, newLocaleInput,
  startAddLocale, confirmAddLocale,
} = useLocaleQuickAdd()
const { openModal, confirm } = useModal()

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

// Capture-phase Escape so the drawer closes before SettingsEditor's
// window handler (bubble phase) pulls focus back to the code editor.
function onKeydownCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydownCapture, true))
</script>

<template>
  <!-- backdrop: outside click closes -->
  <div class="fixed inset-0 z-40" @click="emit('close')" @contextmenu.prevent="emit('close')" />

  <div class="absolute inset-0 z-50 flex flex-col overflow-y-auto border-r border-accent/50 bg-background p-1">
    <div class="flex items-center gap-2 px-2 py-1">
      <Files class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="flex-1 text-xs font-medium">Pages</span>
      <ButtonUI
        variant="icon" size="sm" :icon="Plus" tooltip="Create page"
        class="w-7 text-muted-foreground"
        @click.stop="((createPage()), emit('close'))"
      />
    </div>
    <div v-for="page in regularPages" :key="page.id" class="group/row flex items-center">
      <ButtonUI
        variant="ghost" size="sm" :icon="File"
        class="min-w-0 flex-1 justify-start pl-6"
        :class="isActivePage(page.id) ? '' : 'text-muted-foreground'"
        @click="((openPage(page.id)), emit('close'))"
      >
        <span class="truncate">{{ page.name }}</span>
      </ButtonUI>
      <ButtonUI
        variant="icon" size="sm" :icon="Copy" tooltip="Duplicate page"
        class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
        @click.stop="duplicatePage(page.id)"
      />
      <ButtonUI
        v-if="page.id !== homePage.id"
        variant="icon" size="sm" :icon="Trash2" tooltip="Delete page"
        class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
        @click.stop="removePage(page.id)"
      />
    </div>

    <template v-for="collection in collections" :key="collection.id">
      <div class="mx-2 my-1 h-px bg-input" />
      <div class="group/row flex items-center gap-2 px-2">
        <Layers class="size-3.5 shrink-0 text-muted-foreground" />
        <button
          class="min-w-0 flex-1 truncate text-left text-xs font-medium"
          @click="((openPage(collection.templatePageId)), emit('close'))"
        >
          {{ collection.name }}
        </button>
        <ButtonUI
          variant="icon" size="sm" :icon="Copy" tooltip="Duplicate collection"
          class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
          @click.stop="duplicateCollection(collection)"
        />
        <ButtonUI
          variant="icon" size="sm" :icon="Trash2" tooltip="Delete collection"
          class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
          @click.stop="confirmDeleteCollection(collection)"
        />
        <ButtonUI
          variant="icon" size="sm" :icon="Plus" :tooltip="`New ${collection.name}`"
          class="w-7 shrink-0 text-muted-foreground"
          @click.stop="((newEntry(collection)), emit('close'))"
        />
      </div>
      <div v-for="entry in collection.entries" :key="entry.id" class="group/row flex items-center">
        <ButtonUI
          variant="ghost" size="sm" :icon="FileText"
          class="min-w-0 flex-1 justify-start pl-6"
          :class="activeEntryId === entry.id ? '' : 'text-muted-foreground'"
          @click="((openEntry(collection, entry.id)), emit('close'))"
        >
          <span class="truncate">{{ entry.name }}</span>
        </ButtonUI>
        <ButtonUI
          variant="icon" size="sm" :icon="Copy" :tooltip="`Duplicate ${collection.name}`"
          class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
          @click.stop="duplicateEntry(collection, entry.id)"
        />
        <ButtonUI
          variant="icon" size="sm" :icon="Trash2" :tooltip="`Delete ${collection.name}`"
          class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
          @click.stop="confirmDeleteEntry(collection, entry)"
        />
      </div>
    </template>

    <div class="mx-2 my-1 h-px bg-input" />
    <ButtonUI
      variant="ghost" size="sm" :icon="Layers"
      class="w-full justify-start text-muted-foreground"
      @click="((openModal(CreateCollectionModal)), emit('close'))"
    >
      Create collection
    </ButtonUI>

    <!-- localization -->
    <div class="mt-auto pt-2">
      <div class="mx-2 my-1 h-px bg-input" />
      <div class="flex items-center gap-2 px-2 py-1">
        <Languages class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="flex-1 text-xs font-medium">Locales</span>
      </div>
      <div v-for="loc in locales" :key="loc" class="group/loc flex items-center">
        <ButtonUI
          variant="ghost" size="sm"
          class="min-w-0 flex-1 justify-start pl-6"
          :class="loc === activeLocale ? '' : 'text-muted-foreground'"
          @click="((setActiveLocale(loc)), (addingLocale = false))"
        >
          {{ loc.toUpperCase() }}{{ loc === defaultLocale ? ' · default' : '' }}
        </ButtonUI>
        <ButtonUI
          v-if="loc !== defaultLocale"
          variant="icon" size="sm" :icon="Trash2" tooltip="Delete locale"
          class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/loc:opacity-100 hover:text-danger"
          @click.stop="confirmDeleteLocale(loc)"
        />
      </div>
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
    </div>
  </div>
</template>
