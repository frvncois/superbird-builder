<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Check,
  FileText,
  Film,
  FolderPlus,
  Folder as FolderIcon,
  Image as ImageIcon,
  LayoutGrid,
  Music,
  Pencil,
  Search,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import MediaGrid from '@/components/editor/media/MediaGrid.vue'
import MediaDetails from '@/components/editor/media/MediaDetails.vue'
import { useMedia } from '@/composables/useMedia'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useModal } from '@/composables/useModal'
import { acceptFor, KIND_LABELS } from '@/lib/media'
import type { MediaAsset, MediaKind } from '@/types/media'

const emit = defineEmits<{ close: [] }>()

const { assets, folders, loaded, loadMedia, upload, updateAsset, removeAsset, usage, createFolder, renameFolder, removeFolder } =
  useMedia()
const { selectAccept, pick } = useMediaLibrary()

/** select mode: resolve the caller's promise, then close through the modal host */
function pickAndClose(asset: MediaAsset) {
  pick(asset)
  emit('close')
}
const { confirm } = useModal()

// boot may have failed silently — retry when the modal opens
const loadError = ref<string | null>(null)
onMounted(() => {
  loadMedia().catch((err) => {
    loadError.value = err instanceof Error ? err.message : 'could not load the media library'
  })
})

const selecting = computed(() => selectAccept.value !== null)

// ----- filtering: folder / kind / search -----
// filter is either 'all', a kind, or a folder id
const filter = ref<string>('all')
const query = ref('')

const KIND_ICONS = { image: ImageIcon, video: Film, audio: Music, document: FileText, font: Type }
const KINDS = Object.keys(KIND_LABELS) as MediaKind[]
/** kinds shown in the sidebar — narrowed to the accepted set in select mode */
const visibleKinds = computed(() => KINDS.filter((k) => !selectAccept.value || selectAccept.value.includes(k)))

const filtered = computed(() => {
  let list = assets.value
  if (selectAccept.value) list = list.filter((a) => selectAccept.value!.includes(a.kind))
  if (KINDS.includes(filter.value as MediaKind)) list = list.filter((a) => a.kind === filter.value)
  else if (filter.value !== 'all') list = list.filter((a) => a.folderId === filter.value)
  const q = query.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (a) => a.name.toLowerCase().includes(q) || a.filename.toLowerCase().includes(q),
    )
  }
  return list
})

// ----- selection + details rail -----
const selectedId = ref<string | null>(null)
const selected = computed(() => assets.value.find((a) => a.id === selectedId.value) ?? null)
/** bumped after replace-in-place so previews escape the browser cache */
const version = ref(0)

function onPick(asset: MediaAsset) {
  if (selecting.value) pickAndClose(asset)
}

// ----- upload (file input + drag-and-drop share one path) -----
const uploadInput = ref<HTMLInputElement>()
/** "2/5" while a batch runs, null when idle */
const uploadProgress = ref<string | null>(null)
const uploadError = ref<string | null>(null)

async function uploadFiles(files: File[], folderId?: string) {
  if (!files.length || uploadProgress.value) return
  uploadError.value = null
  // no explicit target: the active folder filter becomes the destination
  folderId ??= folders.value.some((f) => f.id === filter.value) ? filter.value : undefined
  for (const [i, file] of files.entries()) {
    uploadProgress.value = `${i + 1}/${files.length}`
    try {
      const asset = await upload(file, folderId)
      selectedId.value = asset.id
    } catch (err) {
      uploadError.value = err instanceof Error ? err.message : 'upload failed'
    }
  }
  uploadProgress.value = null
}

function onUploadFiles(e: Event) {
  const files = [...((e.target as HTMLInputElement).files ?? [])]
  ;(e.target as HTMLInputElement).value = ''
  void uploadFiles(files)
}

// drop zone: files dropped anywhere on the grid pane upload; the overlay
// shows only for OS file drags (not for tile-to-folder drags)
const dragDepth = ref(0)
const dragActive = computed(() => dragDepth.value > 0)
const isFileDrag = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')

function onDragEnter(e: DragEvent) {
  if (isFileDrag(e)) dragDepth.value++
}
function onDragLeave(e: DragEvent) {
  if (isFileDrag(e)) dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0
  void uploadFiles([...(e.dataTransfer?.files ?? [])])
}

// sidebar folders accept both tile drags (move) and file drags (upload into)
async function onFolderDrop(e: DragEvent, folderId: string | null) {
  const assetId = e.dataTransfer?.getData('application/x-guano-asset')
  if (assetId) {
    await updateAsset(assetId, { folderId })
    return
  }
  void uploadFiles([...(e.dataTransfer?.files ?? [])], folderId ?? undefined)
}

// ----- delete (with usage warning) -----
async function requestDelete(asset: MediaAsset) {
  let message = `Delete “${asset.name}”? This cannot be undone.`
  try {
    const used = await usage(asset.id)
    if (used.total > 0) {
      const branches = used.branches.length
      message =
        `“${asset.name}” is used in ${used.total} place${used.total === 1 ? '' : 's'}` +
        (branches > 1 ? ` across ${branches} branches` : '') +
        '. Elements using it will appear broken after deletion.'
    }
  } catch {
    /* scan failing shouldn't block deletion — fall back to the generic message */
  }
  if (!(await confirm({ title: 'Delete file', message }))) return
  await removeAsset(asset.id)
  if (selectedId.value === asset.id) selectedId.value = null
}

// ----- folders -----
const addingFolder = ref(false)
const folderName = ref('')
const renamingFolderId = ref<string | null>(null)

async function commitFolder() {
  const name = folderName.value.trim()
  folderName.value = ''
  if (addingFolder.value) {
    addingFolder.value = false
    if (name) filter.value = (await createFolder(name)).id
  } else if (renamingFolderId.value) {
    const id = renamingFolderId.value
    renamingFolderId.value = null
    if (name) await renameFolder(id, name)
  }
}

async function requestFolderDelete(id: string) {
  const ok = await confirm({
    title: 'Delete folder',
    message: 'The folder will be removed; its files move to the library root.',
  })
  if (!ok) return
  await removeFolder(id)
  if (filter.value === id) filter.value = 'all'
}
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
            placeholder="Search media…"
            class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <span v-if="selecting" class="text-xs text-muted-foreground">
          Pick a file — double-click or use the button in the side panel
        </span>
        <div class="flex-1" />
        <span v-if="uploadError" class="text-xs text-danger">{{ uploadError }}</span>
        <ButtonUI size="sm" :icon="Upload" :disabled="!!uploadProgress" @click="uploadInput?.click()">
          {{ uploadProgress ? `Uploading ${uploadProgress}…` : 'Upload' }}
        </ButtonUI>
        <input
          ref="uploadInput"
          type="file"
          multiple
          :accept="acceptFor(selectAccept)"
          class="hidden"
          @change="onUploadFiles"
        />
        <ButtonUI variant="ghost" :icon="X" class="w-7 text-muted-foreground" @click="$emit('close')" />
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- sidebar: kinds + folders -->
        <div class="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-input p-2">
          <ButtonUI
            variant="ghost" size="sm" :icon="LayoutGrid"
            class="w-full justify-start"
            :class="filter === 'all' ? 'text-foreground' : 'text-muted-foreground'"
            @click="filter = 'all'"
            @dragover.prevent
            @drop.prevent="onFolderDrop($event, null)"
          >
            All media
          </ButtonUI>
          <ButtonUI
            v-for="kind in visibleKinds"
            :key="kind"
            variant="ghost" size="sm" :icon="KIND_ICONS[kind]"
            class="w-full justify-start"
            :class="filter === kind ? 'text-foreground' : 'text-muted-foreground'"
            @click="filter = kind"
          >
            {{ KIND_LABELS[kind] }}
          </ButtonUI>

          <div class="mx-1 my-2 h-px shrink-0 bg-input" />

          <div v-for="folder in folders" :key="folder.id" class="group/folder relative">
            <InputUI
              v-if="renamingFolderId === folder.id"
              v-model="folderName"
              placeholder="Folder name"
              @keydown.enter="commitFolder"
              @blur="commitFolder"
            />
            <template v-else>
              <ButtonUI
                variant="ghost" size="sm" :icon="FolderIcon"
                class="w-full justify-start pr-12"
                :class="filter === folder.id ? 'text-foreground' : 'text-muted-foreground'"
                @click="filter = folder.id"
                @dragover.prevent
                @drop.prevent="onFolderDrop($event, folder.id)"
              >
                <span class="truncate">{{ folder.name }}</span>
              </ButtonUI>
              <span
                class="absolute top-1/2 right-1 hidden -translate-y-1/2 gap-0.5 group-hover/folder:flex"
              >
                <ButtonUI
                  variant="icon" size="xs" :icon="Pencil"
                  class="text-muted-foreground"
                  @click="((renamingFolderId = folder.id), (folderName = folder.name))"
                />
                <ButtonUI
                  variant="icon" size="xs" :icon="Trash2"
                  class="text-muted-foreground"
                  @click="requestFolderDelete(folder.id)"
                />
              </span>
            </template>
          </div>

          <InputUI
            v-if="addingFolder"
            v-model="folderName"
            placeholder="Folder name"
            @keydown.enter="commitFolder"
            @blur="commitFolder"
          />
          <ButtonUI
            v-else
            variant="ghost" size="sm" :icon="FolderPlus"
            class="w-full justify-start text-muted-foreground"
            @click="((addingFolder = true), (folderName = ''))"
          >
            New folder
          </ButtonUI>
        </div>

        <!-- grid (drop files anywhere on it to upload) -->
        <div
          class="relative min-w-0 flex-1 overflow-y-auto p-4"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <div
            v-if="dragActive"
            class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10"
          >
            <p class="text-sm font-medium">Drop to upload</p>
          </div>
          <div
            v-if="loadError"
            class="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground"
          >
            <p>{{ loadError }}</p>
            <ButtonUI variant="outline" size="sm" @click="loadMedia().catch(() => {})">Retry</ButtonUI>
          </div>
          <div
            v-else-if="loaded && !filtered.length"
            class="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground"
          >
            <p class="text-sm">{{ query ? 'No matches.' : 'No media here yet.' }}</p>
            <p v-if="!query" class="text-xs">Upload images, video, audio, documents or fonts.</p>
          </div>
          <MediaGrid
            v-else
            :assets="filtered"
            :selected-id="selectedId"
            :version="version"
            @select="selectedId = $event.id"
            @pick="onPick"
          />
        </div>

        <!-- details rail -->
        <div v-if="selected" class="w-72 shrink-0 border-l border-input">
          <div class="flex h-full flex-col">
            <ButtonUI
              v-if="selecting"
              size="sm" :icon="Check"
              class="mx-4 mt-4 justify-center"
              @click="pickAndClose(selected)"
            >
              Use this file
            </ButtonUI>
            <MediaDetails
              :asset="selected"
              :version="version"
              @replaced="version++"
              @delete="requestDelete(selected)"
            />
          </div>
        </div>
      </div>
    </div>
  </ModalHost>
</template>
