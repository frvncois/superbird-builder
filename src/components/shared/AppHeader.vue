<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus, Layers, FileText, File, Files, Copy, Trash2, Rocket, Settings, UserRound, Images,
  CircleDot, Languages, MessageCircle, GitBranch,
} from 'lucide-vue-next'
import DropdownUI from '@/components/ui/DropdownUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import CommentsEditor from '@/components/shared/CommentsEditor.vue'
import MainLogo from '@/assets/MainLogo.vue'
import SettingsPanel from '@/components/shared/SettingsPanel.vue'
import AccountModal from '@/components/shared/AccountModal.vue'
import PublishDialog from '@/components/shared/PublishDialog.vue'
import CreateCollectionModal from '@/components/shared/CreateCollectionModal.vue'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { usePersistence, SAVE_STATES } from '@/composables/usePersistence'
import { usePublish } from '@/composables/usePublish'
import { useLocale } from '@/composables/useLocale'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useModal } from '@/composables/useModal'
import { usePopover } from '@/composables/usePopover'
import { useBranches } from '@/composables/useBranches'
import { usePanel } from '@/composables/usePanel'
import { useHeaderNav } from '@/composables/useHeaderNav'
import { useLocaleQuickAdd } from '@/composables/useLocaleQuickAdd'
import type { Collection, CollectionEntry } from '@/types/editor'

const props = defineProps<{ mode: 'build' | 'preview' }>()
const isPreview = computed(() => props.mode === 'preview')

const router = useRouter()

const { activePage, homePage, duplicatePage, removePage } = usePage()
const {
  collections, duplicateEntry, removeEntry,
  duplicateCollection, removeCollection, openEntry, activeEntryId,
} = useCollections()
const { regularPages, activeIcon, isActivePage, openPage, createPage, newEntry } = useHeaderNav()
const { project } = useProject()
// contributors are preview-only: no build view, no publishing, no settings
const { name: accountName, email: accountEmail, canBuild, logout } = useAuth()
const { status, saveNow } = usePersistence()
const { hasUnpublishedChanges } = usePublish()
const { locales, activeLocale, defaultLocale, setActiveLocale, deleteLocale } = useLocale()
const { openLibrary } = useMediaLibrary()
const { activeBranch, onMain } = useBranches()
const { openPanel } = usePanel()

/** the draft pill jumps to the Drafts panel — build view only (no sidebar in Preview) */
function openDrafts() {
  if (!isPreview.value && canBuild.value) openPanel('branches')
}

const { openModal, confirm } = useModal()
const { togglePopover } = usePopover()

// comments popover, anchored below its header button in the app PopoverHost
const commentsBtn = ref<InstanceType<typeof ButtonUI>>()
function toggleComments() {
  const anchor = commentsBtn.value?.$el as HTMLElement | undefined
  if (!anchor) return
  togglePopover({
    id: 'comments',
    component: CommentsEditor,
    anchor,
    placement: 'bottom-end',
    title: 'Comments',
    icon: MessageCircle,
    closeOnOutside: true,
  })
}

// destructive deletes go through the app-level confirm() modal
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

// --- localization ---

const localeLabel = computed(() => activeLocale.value.toUpperCase())
const {
  addingLocale, newLocale, newLocaleInput,
  startAddLocale, confirmAddLocale,
} = useLocaleQuickAdd()

// --- Build / Preview switch ---

function goMode(mode: 'build' | 'preview') {
  if (mode === props.mode) return
  router.push(mode === 'preview' ? '/preview' : '/')
}
</script>

<template>
  <div class="grid w-full grid-cols-[16rem_1fr_16rem] items-center gap-2">
    <!-- col 1: project — aligned to the left sidebar width -->
    <div class="flex items-center">
      <DropdownUI :label="project.name" :icon="MainLogo" variant="filled" width="w-60">
        <template #default="{ close }">
          <ButtonUI
            v-if="canBuild"
            variant="ghost" size="sm" :icon="Settings"
            class="w-full justify-start text-muted-foreground"
            @click="((openModal(SettingsPanel)), close())"
          >
            Project Settings
          </ButtonUI>
          <ButtonUI
            variant="ghost" size="sm" :icon="Images"
            class="w-full justify-start text-muted-foreground"
            @click="(openLibrary(), close())"
          >
            Media Library
          </ButtonUI>

          <div class="mx-1 my-1 h-px bg-input" />

          <div class="flex items-center gap-2 px-1 py-1">
            <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserRound class="size-3.5" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-medium">{{ accountName || 'Your account' }}</p>
              <p class="truncate text-[10px] text-muted-foreground">{{ accountEmail }}</p>
            </div>
          </div>
          <div class="mt-1 flex gap-1">
            <ButtonUI variant="outline" size="sm" class="flex-1 justify-center" @click="((openModal(AccountModal)), close())">
              My account
            </ButtonUI>
            <ButtonUI variant="outline" size="sm" class="flex-1 justify-center" @click="logout">
              Logout
            </ButtonUI>
          </div>
        </template>
      </DropdownUI>
    </div>

    <!-- col 2: page selector + localization + view switch — centered -->
    <div class="flex items-center justify-center gap-2">
      <DropdownUI :label="activePage.name" :icon="activeIcon" width="w-64">
        <template #default="{ close }">
          <div class="flex items-center gap-2 px-2">
            <Files class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="flex-1 text-xs font-medium">Pages</span>
            <ButtonUI
              v-if="!isPreview"
              variant="icon" size="sm" :icon="Plus" tooltip="Create page"
              class="w-7 text-muted-foreground"
              @click.stop="((createPage()), close())"
            />
          </div>
          <div v-for="page in regularPages" :key="page.id" class="group/row flex items-center">
            <ButtonUI
              variant="ghost" size="sm" :icon="File"
              class="min-w-0 flex-1 justify-start pl-6"
              :class="isActivePage(page.id) ? '' : 'text-muted-foreground'"
              @click="((openPage(page.id)), close())"
            >
              <span class="truncate">{{ page.name }}</span>
            </ButtonUI>
            <template v-if="!isPreview">
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
            </template>
          </div>

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
              <template v-if="!isPreview">
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
              </template>
              <ButtonUI
                variant="icon" size="sm" :icon="Plus" :tooltip="`New ${collection.name}`"
                class="w-7 shrink-0 text-muted-foreground"
                @click.stop="((newEntry(collection)), close())"
              />
            </div>
            <div v-for="entry in collection.entries" :key="entry.id" class="group/row flex items-center">
              <ButtonUI
                variant="ghost" size="sm" :icon="FileText"
                class="min-w-0 flex-1 justify-start pl-6"
                :class="activeEntryId === entry.id ? '' : 'text-muted-foreground'"
                @click="((openEntry(collection, entry.id)), close())"
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

          <template v-if="!isPreview">
            <div class="mx-2 my-1 h-px bg-input" />
            <ButtonUI
              variant="ghost" size="sm" :icon="Layers"
              class="w-full justify-start text-muted-foreground"
              @click="((openModal(CreateCollectionModal)), close())"
            >
              Create collection
            </ButtonUI>
          </template>
        </template>
      </DropdownUI>

      <!-- localization (both modes) -->
      <DropdownUI :label="localeLabel" :icon="Languages" width="w-40">
        <template #default="{ close }">
          <div v-for="loc in locales" :key="loc" class="group/loc flex items-center">
            <ButtonUI
              variant="ghost" size="sm"
              class="min-w-0 flex-1 justify-start"
              :class="loc === activeLocale ? '' : 'text-muted-foreground'"
              @click="((setActiveLocale(loc)), (addingLocale = false), close())"
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
            @keydown.enter.prevent="confirmAddLocale(close)"
            @keydown.esc.stop.prevent="addingLocale = false"
          />
        </template>
      </DropdownUI>

      <!-- comments (both modes) -->
      <ButtonUI
        ref="commentsBtn"
        :icon="MessageCircle"
        variant="outline"
        tooltip="Comments"
        tooltip-side="bottom"
        @click="toggleComments"
      />

      <!-- Build / Preview switch (contributors are preview-only) -->
      <div v-if="canBuild" class="flex rounded-xl border border-accent p-1 h-9 text-xs">
        <button
          class="flex cursor-pointer items-center rounded-lg px-4 font-medium"
          :class="!isPreview ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="goMode('build')"
        >
          Build
        </button>
        <button
          class="flex cursor-pointer items-center rounded-lg px-4 font-medium"
          :class="isPreview ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="goMode('preview')"
        >
          Preview
        </button>
      </div>
    </div>

    <!-- col 3: status + publish — aligned to the right sidebar width -->
    <div class="flex items-center justify-end gap-2">
      <ButtonUI
        variant="mono" size="sm" :icon="GitBranch"
        :class="onMain ? 'text-muted-foreground' : 'text-pending'"
        :tooltip="onMain ? 'Editing Main' : `Editing draft “${activeBranch.name}” — merge into Main, then publish to go live`"
        tooltip-side="bottom"
        @click="openDrafts"
      >
        {{ onMain ? 'Main branch' : activeBranch.name }}
      </ButtonUI>
      <button
        v-tooltip.bottom="SAVE_STATES[status].label"
        type="button"
        class="flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px]"
        :class="SAVE_STATES[status].class"
        @click="saveNow"
      >
        <span class="size-1.5 rounded-full" :class="SAVE_STATES[status].dot" />
        {{ SAVE_STATES[status].short }}
      </button>
      <template v-if="canBuild">
        <span
          v-tooltip.bottom="hasUnpublishedChanges ? 'Main has unpublished changes' : 'Everything is published'"
          class="flex w-6 items-center justify-center"
          :class="hasUnpublishedChanges ? 'text-pending' : 'text-success'"
        >
          <CircleDot class="size-3.5" />
        </span>
        <ButtonUI variant="default" size="sm" :icon="Rocket" @click="openModal(PublishDialog)">
          Publish
        </ButtonUI>
      </template>
    </div>
  </div>

</template>
