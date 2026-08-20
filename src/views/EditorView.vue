<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Layers, FileText, File, Files, Copy, Trash2, Rocket, Settings, UserRound, LogOut } from 'lucide-vue-next'
import InsertDragChip from '@/components/editor/InsertDragChip.vue'
import SettingsPanel from '@/components/editor/SettingsPanel.vue'
import EditorLayout from '@/layouts/EditorLayout.vue'
import CanvasEditor from '@/components/editor/CanvasEditor.vue'
import ContextMenu from '@/components/editor/ContextMenu.vue'
import CreateComponentModal from '@/components/editor/CreateComponentModal.vue'
import CreateCollectionModal from '@/components/editor/CreateCollectionModal.vue'
import PublishDialog from '@/components/editor/PublishDialog.vue'
import AccountModal from '@/components/editor/AccountModal.vue'
import { useAuth } from '@/composables/useAuth'
import CheatModal from '@/components/editor/CheatModal.vue'
import { useCheatSheet } from '@/composables/useCheatSheet'
import TooltipUI from '@/components/ui/TooltipUI.vue'
import { CircleDot } from 'lucide-vue-next'
import { usePersistence } from '@/composables/usePersistence'
import { useProject } from '@/composables/useProject'
import { migrateStoredProject } from '@/lib/storage'
import { hydrateStore, migrateLocalToServer, storeGet } from '@/lib/store'
import { usePublish, hydratePublishState } from '@/composables/usePublish'
import { useEditorShortcuts } from '@/composables/useEditorShortcuts'

// editor-zone globals: keymaps live here (NOT in App.vue) so the public
// site never boots them
useEditorShortcuts()

// async boot: hydrate the server-backed store, then start persistence.
// The router guard already verified the session.
const ready = ref(false)
const bootError = ref<string | null>(null)
const reloadPage = () => window.location.reload()
;(async () => {
  try {
    await hydrateStore([
      'superbird-branches',
      'superbird-published-baseline',
      'superbird-published-info',
    ])
    // one-time import of a pre-auth localStorage project
    await migrateLocalToServer()
    const meta = storeGet('superbird-branches')
    const activeId = meta ? ((JSON.parse(meta).activeId as string) ?? 'main') : 'main'
    await hydrateStore([`superbird-project:${activeId}`])
    hydratePublishState()

    // fresh install: no stored project yet, so init() will persist the
    // in-memory default. Apply the name captured at setup before that
    // first snapshot is taken, then clear the stash so it can't leak
    // into a later project.
    const setupName = localStorage.getItem('superbird-setup-name')
    if (setupName) {
      if (!storeGet(`superbird-project:${activeId}`)) {
        useProject().renameProject(setupName)
      }
      localStorage.removeItem('superbird-setup-name')
    }

    usePersistence().init() // sync, runs against the warm cache
    ready.value = true

    // dev convenience: /admin?demo replaces the project with the
    // generated showcase (public/demo-project.json)
    if (new URLSearchParams(window.location.search).has('demo')) {
      const res = await fetch('/demo-project.json')
      const demo = res.ok && migrateStoredProject(await res.json())
      if (demo) usePersistence().resetTo(demo)
    }
  } catch {
    bootError.value = 'Cannot reach the server — is `npm run serve` running?'
  }
})()
import CodeEditor from '@/components/editor/CodeEditor.vue'
import SettingsEditor from '@/components/editor/SettingsEditor.vue'
import DropdownUI from '@/components/ui/DropdownUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import type { Collection } from '@/types/editor'
import MainLogo from '@/assets/MainLogo.vue'

const { pages, activePage, homePage, addPage, duplicatePage, removePage, setActivePage } = usePage()
const {
  collections,
  addEntry,
  duplicateEntry,
  removeEntry,
  duplicateCollection,
  removeCollection,
  openEntry,
  activeEntryId,
} = useCollections()

const creatingCollection = ref(false)
const publishing = ref(false)
const accountOpen = ref(false)
const settingsOpen = ref(false)
const { project } = useProject()
const { name: accountName, email: accountEmail, logout } = useAuth()

const { status, saveNow } = usePersistence()
const { hasUnpublishedChanges } = usePublish()
const { cheatOpen, close: closeCheatSheet } = useCheatSheet()
const SAVE_STATES = {
  saved: { class: 'text-success', dot: 'bg-success', short: 'Saved', label: 'All changes saved' },
  pending: { class: 'text-pending', dot: 'bg-pending', short: 'Saving…', label: 'Saving…' },
  error: { class: 'text-danger', dot: 'bg-danger', short: 'Save failed', label: 'Save failed — click to retry' },
} as const

/** ordinary pages — collection templates are listed under their collection */
const regularPages = computed(() => pages.value.filter((p) => !p.collectionId))

/** icon for the current selection shown on the dropdown trigger */
const activeIcon = computed(() => {
  if (activeEntryId.value) return FileText // editing a collection entry
  if (activePage.value.collectionId) return Layers // a collection template
  return File
})

const isActivePage = (id: string) => !activeEntryId.value && activePage.value.id === id

function openPage(id: string) {
  setActivePage(id)
  activeEntryId.value = null
}

function createPage() {
  addPage(`Page ${regularPages.value.length + 1}`)
}

function newEntry(collection: Collection) {
  const entry = addEntry(collection)
  openEntry(collection, entry.id)
}
</script>

<template>
  <div
    v-if="bootError"
    class="flex min-h-screen flex-col items-center justify-center gap-3 bg-background"
  >
    <p class="text-sm font-medium">{{ bootError }}</p>
    <ButtonUI variant="outline" size="sm" @click="reloadPage">Retry</ButtonUI>
  </div>

  <EditorLayout v-else-if="ready">
    <template #header>
      <div class="flex w-full items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <!-- Project: account card + account / settings entry points -->
          <DropdownUI :label="project.name" :icon="MainLogo" width="w-60">
            <template #default="{ close }">
              <div class="flex items-center gap-2 px-2 py-1">
                <div
                  class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                >
                  <UserRound class="size-3.5" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-medium">{{ accountName || 'Your account' }}</p>
                  <p class="truncate text-[10px] text-muted-foreground">{{ accountEmail }}</p>
                </div>
                <ButtonUI
                  variant="icon"
                  size="sm"
                  :icon="LogOut"
                  title="Sign out"
                  class="w-7 text-muted-foreground"
                  @click.stop="logout"
                />
              </div>
              <div class="mx-2 my-1 h-px bg-input" />
              <ButtonUI
                variant="ghost"
                size="sm"
                :icon="UserRound"
                class="w-full justify-start text-muted-foreground"
                @click="((accountOpen = true), close())"
              >
                My account
              </ButtonUI>
              <ButtonUI
                variant="ghost"
                size="sm"
                :icon="Settings"
                class="w-full justify-start text-muted-foreground"
                @click="((settingsOpen = true), close())"
              >
                Settings
              </ButtonUI>
            </template>
          </DropdownUI>

          <!-- Page selector -->
          <DropdownUI :label="activePage.name" :icon="activeIcon" variant="filled" width="w-64">
            <template #default="{ close }">
              <!-- Pages -->
              <div class="flex items-center gap-2 px-2">
                <Files class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="flex-1 text-xs font-medium">Pages</span>
                <ButtonUI
                  variant="icon"
                  size="sm"
                  :icon="Plus"
                  title="Create page"
                  class="w-7 text-muted-foreground"
                  @click.stop="createPage"
                />
              </div>
              <div v-for="page in regularPages" :key="page.id" class="group/row flex items-center">
                <ButtonUI
                  variant="ghost"
                  size="sm"
                  :icon="File"
                  class="min-w-0 flex-1 justify-start pl-6"
                  :class="isActivePage(page.id) ? '' : 'text-muted-foreground'"
                  @click="((openPage(page.id)), close())"
                >
                  <span class="truncate">{{ page.name }}</span>
                </ButtonUI>
                <ButtonUI
                  variant="icon"
                  size="sm"
                  :icon="Copy"
                  title="Duplicate page"
                  class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
                  @click.stop="duplicatePage(page.id)"
                />
                <ButtonUI
                  v-if="page.id !== homePage.id"
                  variant="icon"
                  size="sm"
                  :icon="Trash2"
                  title="Delete page"
                  class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
                  @click.stop="removePage(page.id)"
                />
              </div>

              <!-- Collections -->
              <template v-for="collection in collections" :key="collection.id">
                <div class="mx-2 my-1 h-px bg-input" />
                <div class="group/row flex items-center gap-2 px-2">
                  <Layers class="size-3.5 shrink-0 text-muted-foreground" />
                  <button
                    class="min-w-0 flex-1 truncate text-left text-xs font-medium"
                    @click="((openPage(collection.templatePageId)), close())"
                  >
                    {{ collection.name }}
                  </button>
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="Copy"
                    title="Duplicate collection"
                    class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
                    @click.stop="duplicateCollection(collection)"
                  />
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="Trash2"
                    title="Delete collection"
                    class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
                    @click.stop="removeCollection(collection)"
                  />
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="Plus"
                    :title="`New ${collection.name}`"
                    class="w-7 shrink-0 text-muted-foreground"
                    @click.stop="((newEntry(collection)), close())"
                  />
                </div>
                <div
                  v-for="entry in collection.entries"
                  :key="entry.id"
                  class="group/row flex items-center"
                >
                  <ButtonUI
                    variant="ghost"
                    size="sm"
                    :icon="FileText"
                    class="min-w-0 flex-1 justify-start pl-6"
                    :class="activeEntryId === entry.id ? '' : 'text-muted-foreground'"
                    @click="((openEntry(collection, entry.id)), close())"
                  >
                    <span class="truncate">{{ entry.name }}</span>
                  </ButtonUI>
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="Copy"
                    :title="`Duplicate ${collection.name}`"
                    class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
                    @click.stop="duplicateEntry(collection, entry.id)"
                  />
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="Trash2"
                    :title="`Delete ${collection.name}`"
                    class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
                    @click.stop="removeEntry(collection, entry.id)"
                  />
                </div>
              </template>

              <div class="mx-2 my-1 h-px bg-input" />
              <ButtonUI
                variant="ghost"
                size="sm"
                :icon="Layers"
                class="w-full justify-start text-muted-foreground"
                @click="((creatingCollection = true), close())"
              >
                Create collection
              </ButtonUI>
            </template>
          </DropdownUI>

          <InsertDragChip />
        </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px]"
          :class="SAVE_STATES[status].class"
          :title="SAVE_STATES[status].label"
          @click="saveNow"
        >
          <span class="size-1.5 rounded-full" :class="SAVE_STATES[status].dot" />
          {{ SAVE_STATES[status].short }}
        </button>
        <ButtonUI variant="default" size="sm" :icon="Rocket" @click="publishing = true">
          Publish
        </ButtonUI>
        <TooltipUI
          :text="hasUnpublishedChanges ? 'Unpublished changes' : 'Everything is published'"
          side="bottom"
        >
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="CircleDot"
            class="w-6"
            :class="hasUnpublishedChanges ? 'text-pending' : 'text-success'"
            @click="publishing = true"
          />
        </TooltipUI>
      </div>
      </div>
    </template>

    <template #left>
      <CodeEditor />
    </template>

    <CanvasEditor />
    <ContextMenu />
    <CreateComponentModal />
    <CreateCollectionModal v-if="creatingCollection" @close="creatingCollection = false" />
    <PublishDialog v-if="publishing" @close="publishing = false" />
    <AccountModal :open="accountOpen" @close="accountOpen = false" />
    <SettingsPanel :open="settingsOpen" @close="settingsOpen = false" />
    <CheatModal v-if="cheatOpen" @close="closeCheatSheet" />

    <template #right>
      <SettingsEditor />
    </template>
  </EditorLayout>

  <div v-else class="flex min-h-screen items-center justify-center bg-background">
    <p class="text-xs text-muted-foreground">Loading…</p>
  </div>
</template>
