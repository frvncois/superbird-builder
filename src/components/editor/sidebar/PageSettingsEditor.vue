<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft, Copy, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SettingsGroup from '@/components/shared/SettingsGroup.vue'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useModal } from '@/composables/useModal'
import { timeAgo } from '@/lib/time'

/** what the drawer is showing settings for */
export type SettingsTarget =
  | { kind: 'page'; pageId: string }
  | { kind: 'entry'; collectionId: string; entryId: string }

const props = defineProps<{ target: SettingsTarget }>()
const emit = defineEmits<{ back: []; close: [] }>()

const { pages, updatePageMeta, duplicatePage, removePage, homePage } = usePage()
const { collections, updateEntryMeta, duplicateEntry, removeEntry } = useCollections()
const { confirm } = useModal()

const STATUS_OPTIONS = [
  { label: 'Published', value: 'published' },
  { label: 'Draft', value: 'draft' },
]

// --- resolve the target (narrow the union through a local const) ---
const page = computed(() => {
  const t = props.target
  return t.kind === 'page' ? (pages.value.find((p) => p.id === t.pageId) ?? null) : null
})
const collection = computed(() => {
  const t = props.target
  return t.kind === 'entry' ? (collections.value.find((c) => c.id === t.collectionId) ?? null) : null
})
const entry = computed(() => {
  const t = props.target
  return t.kind === 'entry' && collection.value
    ? (collection.value.entries.find((e) => e.id === t.entryId) ?? null)
    : null
})

/** the thing that carries seo / status / timestamps, whichever kind */
const item = computed(() => page.value ?? entry.value)
const kindLabel = computed(() => (props.target.kind === 'page' ? 'Page' : 'Item'))
const isHome = computed(() => props.target.kind === 'page' && page.value?.id === homePage.value.id)

// --- title / slug: committed on change (page edits rebuild the @setup block) ---
const titleField = ref('')
const slugField = ref('')
watch(
  item,
  (it) => {
    if (!it) return
    titleField.value = it.name
    slugField.value = page.value ? page.value.path : (entry.value?.slug ?? '')
  },
  { immediate: true },
)

function commitTitle() {
  const name = titleField.value.trim()
  if (!name) return
  if (page.value) updatePageMeta(page.value.id, { name })
  else if (collection.value && entry.value)
    updateEntryMeta(collection.value, entry.value.id, { name })
}
function commitSlug() {
  const slug = slugField.value.trim()
  if (page.value) updatePageMeta(page.value.id, { slug })
  else if (collection.value && entry.value)
    updateEntryMeta(collection.value, entry.value.id, { slug })
}

const status = computed({
  get: () => item.value?.status ?? 'published',
  set: (v: string) => {
    if (page.value) updatePageMeta(page.value.id, { status: v })
    else if (collection.value && entry.value)
      updateEntryMeta(collection.value, entry.value.id, { status: v })
  },
})

// --- SEO: mutated directly; empty values prune so untouched items stay
// byte-identical. The edit-tracking watcher stamps updatedAt. ---
function seoField(key: 'title' | 'description') {
  return computed({
    get: () => item.value?.seo?.[key] ?? '',
    set: (v: string) => {
      const it = item.value
      if (!it) return
      if (v) (it.seo ??= {})[key] = v
      else if (it.seo) {
        delete it.seo[key]
        if (!Object.keys(it.seo).length) delete it.seo
      }
    },
  })
}
const seoTitle = seoField('title')
const seoDescription = seoField('description')

// --- actions ---
function onDuplicate() {
  if (page.value) duplicatePage(page.value.id)
  else if (collection.value && entry.value) duplicateEntry(collection.value, entry.value.id)
  emit('back')
}

async function onDelete() {
  const name = item.value?.name ?? 'this'
  const ok = await confirm({
    title: `Delete ${kindLabel.value.toLowerCase()}`,
    message: `Delete “${name}”? This can’t be undone.`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  if (page.value) removePage(page.value.id)
  else if (collection.value && entry.value) removeEntry(collection.value, entry.value.id)
  emit('back')
}

function whenBy(at?: number, by?: string): string {
  if (!at) return '—'
  return by ? `${timeAgo(at)} · ${by}` : timeAgo(at)
}
</script>

<template>
  <div v-if="item" class="flex flex-col gap-3 p-1">
    <div class="flex items-center gap-1 border-y border-input px-1 py-1.5">
      <ButtonUI variant="icon" size="sm" :icon="ArrowLeft" tooltip="Back" class="w-7 text-muted-foreground" @click="emit('back')" />
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ kindLabel }} settings</span>
    </div>

    <SettingsGroup title="General" description="Title, address and publish state.">
      <RowUI label="Title">
        <InputUI v-model="titleField" placeholder="Untitled" @blur="commitTitle" @keydown.enter="commitTitle" />
      </RowUI>
      <RowUI label="Slug">
        <InputUI
          v-model="slugField"
          class="font-mono"
          :disabled="isHome"
          :placeholder="page ? '/path' : 'slug'"
          @blur="commitSlug"
          @keydown.enter="commitSlug"
        />
      </RowUI>
      <p v-if="isHome" class="text-[10px] text-muted-foreground">The home page path is fixed.</p>
      <RowUI label="Status">
        <SelectUI v-model="status" :options="STATUS_OPTIONS" />
      </RowUI>
    </SettingsGroup>

    <SettingsGroup title="SEO" :description="`Overrides the site defaults for this ${kindLabel.toLowerCase()}.`">
      <RowUI label="Title">
        <InputUI v-model="seoTitle" placeholder="Overrides the template" />
      </RowUI>
      <TextareaUI v-model="seoDescription" placeholder="Description" :rows="2" />
    </SettingsGroup>

    <SettingsGroup title="Details" description="Authorship and history.">
      <RowUI label="Created">
        <span class="text-xs text-muted-foreground">{{ whenBy(item.createdAt, item.createdBy) }}</span>
      </RowUI>
      <RowUI label="Updated">
        <span class="text-xs text-muted-foreground">{{ whenBy(item.updatedAt, item.updatedBy) }}</span>
      </RowUI>
    </SettingsGroup>

    <div class="flex gap-1.5 px-1">
      <ButtonUI variant="outline" size="sm" :icon="Copy" class="flex-1 justify-center" @click="onDuplicate">
        Duplicate
      </ButtonUI>
      <ButtonUI
        variant="outline" size="sm" :icon="Trash2"
        class="flex-1 justify-center !text-danger"
        :disabled="isHome"
        @click="onDelete"
      >
        Delete
      </ButtonUI>
    </div>
  </div>
</template>
