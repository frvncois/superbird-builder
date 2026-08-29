<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, RefreshCw, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import type { MediaAsset } from '@/types/media'
import type { MediaUsage } from '@/types/media'
import { useMedia } from '@/composables/useMedia'
import { useProject } from '@/composables/useProject'
import { walkNodes } from '@/lib/tree'
import { acceptFor, formatBytes } from '@/lib/media'

const props = defineProps<{
  asset: MediaAsset
  /** cache-buster for previews, bumped by the parent after replace */
  version: number
}>()

const emit = defineEmits<{ replaced: []; delete: [] }>()

const { mediaUrl, updateAsset, replaceAsset, folders, usage } = useMedia()
const { project } = useProject()

// name/alt edit locally, commit on change/blur — not on every keystroke
const name = ref(props.asset.name)
const alt = ref(props.asset.alt ?? '')
watch(
  () => props.asset.id,
  () => {
    name.value = props.asset.name
    alt.value = props.asset.alt ?? ''
  },
)

async function commitName() {
  const value = name.value.trim()
  if (!value || value === props.asset.name) {
    name.value = props.asset.name
    return
  }
  await updateAsset(props.asset.id, { name: value })
}

async function commitAlt() {
  if ((props.asset.alt ?? '') === alt.value) return
  await updateAsset(props.asset.id, { alt: alt.value })
}

// '' = root; SelectUI models strings
const folderModel = computed({
  get: () => props.asset.folderId ?? '',
  set: (value: string) => void updateAsset(props.asset.id, { folderId: value || null }),
})
const folderOptions = computed(() => [
  { label: 'No folder', value: '' },
  ...folders.value.map((f) => ({ label: f.name, value: f.id })),
])

// replace-in-place: same id/URL, new bytes
const replaceInput = ref<HTMLInputElement>()
const busy = ref(false)
const error = ref<string | null>(null)

async function onReplaceFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  busy.value = true
  error.value = null
  try {
    await replaceAsset(props.asset.id, file)
    emit('replaced')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'replace failed'
  } finally {
    busy.value = false
  }
}

const previewSrc = computed(() =>
  props.asset.kind === 'image' || props.asset.kind === 'video'
    ? `${mediaUrl(props.asset)}?v=${props.version}`
    : null,
)

const uploadedOn = computed(() =>
  new Date(props.asset.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }),
)

// ----- where it's used -----
// precise walk of the loaded branch (page names), plus the server's
// cross-branch reference count for everything this client can't see
const usedOn = computed(() => {
  const url = mediaUrl(props.asset)
  const refersTo = (src?: string) => src === url
  const nodeRefs = (n: { src?: string; locales?: Record<string, { src?: string }> }) =>
    (refersTo(n.src) ? 1 : 0) +
    Object.values(n.locales ?? {}).filter((o) => refersTo(o.src)).length

  const spots: string[] = []
  for (const page of project.value.pages) {
    let count = 0
    walkNodes(page.elements, (n) => (count += nodeRefs(n)))
    if (count) spots.push(count > 1 ? `${page.name} ×${count}` : page.name)
  }
  let componentRefs = 0
  for (const c of project.value.components) walkNodes([c.root], (n) => (componentRefs += nodeRefs(n)))
  if (componentRefs) spots.push(`components ×${componentRefs}`)
  let entryRefs = 0
  for (const c of project.value.collections) {
    for (const entry of c.entries) {
      // reference fields hold id arrays, never media srcs
      entryRefs += Object.values(entry.values).filter(
        (v) => typeof v === 'string' && refersTo(v),
      ).length
      for (const values of Object.values(entry.locales ?? {})) {
        entryRefs += Object.values(values).filter(refersTo).length
      }
    }
  }
  if (entryRefs) spots.push(`entries ×${entryRefs}`)
  return spots
})

// cross-branch total from the server (this branch included)
const branchUsage = ref<MediaUsage | null>(null)
watch(
  () => props.asset.id,
  (id) => {
    branchUsage.value = null
    usage(id)
      .then((u) => {
        if (id === props.asset.id) branchUsage.value = u
      })
      .catch(() => {})
  },
  { immediate: true },
)
const usageSummary = computed(() => {
  if (usedOn.value.length) return usedOn.value.join(', ')
  // nothing on this branch — surface saved references elsewhere, if any
  if (branchUsage.value?.total) {
    const n = branchUsage.value.branches.length
    return `${branchUsage.value.total} saved reference${branchUsage.value.total === 1 ? '' : 's'} on ${n} branch${n === 1 ? '' : 'es'}`
  }
  return 'Not used anywhere'
})
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
    <!-- preview -->
    <div class="flex max-h-48 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/60">
      <img
        v-if="asset.kind === 'image'"
        :src="previewSrc!"
        :alt="asset.alt ?? asset.name"
        class="max-h-48 object-contain"
      />
      <video v-else-if="asset.kind === 'video'" :src="previewSrc!" controls class="max-h-48" />
      <span v-else class="px-4 py-10 text-xs text-muted-foreground">{{ asset.mime }}</span>
    </div>

    <div class="flex flex-col gap-2">
      <RowUI label="Name">
        <InputUI v-model="name" placeholder="Asset name" @change="commitName" />
      </RowUI>
      <RowUI v-if="asset.kind === 'image'" label="Alt text">
        <TextareaUI v-model="alt" placeholder="Default alt text" @change="commitAlt" />
      </RowUI>
      <RowUI label="Folder">
        <SelectUI v-model="folderModel" :options="folderOptions" />
      </RowUI>
    </div>

    <div class="flex flex-col rounded-xl border border-input">
      <div class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Type</span>
        <span class="text-xs">{{ asset.mime }}</span>
      </div>
      <div class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Size</span>
        <span class="text-xs">{{ formatBytes(asset.size) }}</span>
      </div>
      <div v-if="asset.width" class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Dimensions</span>
        <span class="text-xs">{{ asset.width }} × {{ asset.height }}</span>
      </div>
      <div class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Uploaded</span>
        <span class="text-xs">{{ uploadedOn }}</span>
      </div>
      <div class="flex justify-between gap-3 px-3 py-2">
        <span class="shrink-0 text-xs text-muted-foreground">Used on</span>
        <span class="text-right text-xs">{{ usageSummary }}</span>
      </div>
    </div>

    <p v-if="error" class="text-xs text-danger">{{ error }}</p>

    <div class="mt-auto flex flex-col gap-1.5">
      <ButtonUI
        variant="outline"
        size="sm"
        :icon="RefreshCw"
        :disabled="busy"
        class="justify-start"
        @click="replaceInput?.click()"
      >
        Replace file — keeps every usage
      </ButtonUI>
      <input
        ref="replaceInput"
        type="file"
        :accept="acceptFor()"
        class="hidden"
        @change="onReplaceFile"
      />
      <a :href="`${mediaUrl(asset)}?download=1`" :download="asset.filename" class="contents">
        <ButtonUI variant="outline" size="sm" :icon="Download" class="w-full justify-start">
          Download
        </ButtonUI>
      </a>
      <ButtonUI
        variant="outline"
        size="sm"
        :icon="Trash2"
        class="justify-start text-danger"
        @click="emit('delete')"
      >
        Delete
      </ButtonUI>
    </div>
  </div>
</template>
