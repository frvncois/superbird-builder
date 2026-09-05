<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import { usePanel } from '@/composables/usePanel'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import RichTextInput from '@/components/editor/content/RichTextInput.vue'
import { ELEMENTS, typeOptionsFor } from '@/lib/elements'
import { hasAncestorOfType } from '@/lib/tree'
import ConditionRows from '@/components/editor/interactions/ConditionRows.vue'
import { useElement } from '@/composables/useElement'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useLocale } from '@/composables/useLocale'
import { resolveBinding, refIds } from '@/lib/shared/fields.js'
import type { CollectionEntry, CollectionField } from '@/types/editor'

const { selectedElement, changeElementType, setElementArg, setElementLink } = useElement()
const { activePage } = usePage()
const {
  collections,
  collectionById,
  collectionByName,
  activeCollection,
  activeEntry,
  addField,
  removeField,
} = useCollections()
const { isDefault, editNodeContent, setNodeContent, editNodeSrc, setNodeSrc, editEntryValue, setEntryValue } =
  useLocale()

const isBody = computed(() => selectedElement.value?.type === 'body')
const isCollectionList = computed(() => selectedElement.value?.type === 'collection-list')
const isCollectionItem = computed(() => selectedElement.value?.type === 'collection-item')

// --- tag ---

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const tagOptions = computed(() =>
  typeOptionsFor(selectedElement.value?.type ?? '').map((t) => ({ label: capitalize(t), value: t })),
)

/** the tag can only be changed on a real page element with alternatives */
const canEditTag = computed(
  () => tagOptions.value.length > 0 && selectedElement.value?.line !== undefined,
)

// --- id ---

const htmlId = computed({
  get: () => selectedElement.value?.htmlId ?? '',
  set: (value: string) => {
    if (selectedElement.value) selectedElement.value.htmlId = value.trim() || undefined
  },
})

// ⌘⇧D focuses the natural first field: the content input when the element
// has editable content, otherwise the ID field
const { pendingFocus } = usePanel()
const idField = ref<InstanceType<typeof InputUI>>()
const contentField = ref<InstanceType<typeof RichTextInput>>()

function consumeFocus() {
  if (pendingFocus.value !== 'data') return
  pendingFocus.value = null
  nextTick(() => (contentField.value ?? idField.value)?.focus())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)

// --- links ---

// any real element can carry a navigation target — the code-owned '@' link.
// (structural containers and the body are excluded.)
const canLink = computed(() => {
  const el = selectedElement.value
  return (
    !!el && el.line !== undefined && !isBody.value && !isCollectionItem.value && !isCollectionList.value
  )
})
const link = computed({
  get: () => selectedElement.value?.link ?? '',
  set: (value: string) => {
    if (selectedElement.value) setElementLink(selectedElement.value.id, value.trim() || null)
  },
})

// a link can point at "the current entry" when it renders inside an entry
// scope: within a collection-list, or on a collection template page
const canLinkEntry = computed(() => {
  const el = selectedElement.value
  if (!el || !canLink.value) return false
  if (activePage.value.collectionId) return true
  return hasAncestorOfType(activePage.value.elements, el.id, 'collection-list')
})

const linkToEntry = computed({
  get: () => selectedElement.value?.link === '@item',
  set: (on: boolean) => {
    if (selectedElement.value) setElementLink(selectedElement.value.id, on ? '@item' : null)
  },
})

// --- field binding (possibly through a reference hop: 'author.name') ---

const canBind = computed(
  () =>
    !!activeCollection.value &&
    !isBody.value &&
    !isCollectionItem.value &&
    !isCollectionList.value &&
    selectedElement.value?.line !== undefined,
)

const bindHead = computed(() => selectedElement.value?.arg?.split('.')[0] ?? '')
const bindTail = computed(() => {
  const arg = selectedElement.value?.arg ?? ''
  const dot = arg.indexOf('.')
  return dot === -1 ? '' : arg.slice(dot + 1)
})

const headField = computed(
  () => activeCollection.value?.fields.find((f) => f.name === bindHead.value) ?? null,
)
/** single references can hop to a field of the target collection */
const refTarget = computed(() =>
  headField.value?.type === 'reference' && headField.value.refCollectionId
    ? collectionById(headField.value.refCollectionId)
    : null,
)

const bindOptions = computed(() => [
  { label: 'None', value: '' },
  ...(activeCollection.value?.fields.map((f) => ({ label: f.name, value: f.name })) ?? []),
])

// hopped-to fields hold values, so references are excluded (one hop max)
const tailOptions = computed(() => [
  { label: 'Entry name', value: '' },
  ...(refTarget.value?.fields
    .filter((f) => f.type !== 'reference' && f.type !== 'multi-reference')
    .map((f) => ({ label: f.name, value: f.name })) ?? []),
])

function setHead(head: string | null) {
  if (!selectedElement.value) return
  setElementArg(selectedElement.value.id, head || null)
}
function setTail(tail: string | null) {
  if (!selectedElement.value || !bindHead.value) return
  setElementArg(selectedElement.value.id, tail ? `${bindHead.value}.${tail}` : bindHead.value)
}

// --- collection-list source: a collection, or a multi-reference field of
// the surrounding template's collection ---

const listOptions = computed(() => {
  const options = collections.value.map((c) => ({ label: c.name, value: c.name }))
  for (const f of activeCollection.value?.fields ?? []) {
    if (f.type === 'multi-reference') options.push({ label: `${f.name} (field)`, value: f.name })
  }
  return options
})

const listSource = computed({
  get: () => selectedElement.value?.arg ?? '',
  set: (value: string) => {
    if (selectedElement.value) setElementArg(selectedElement.value.id, value || null)
  },
})

const def = computed(() => (selectedElement.value ? ELEMENTS[selectedElement.value.type] : null))

// --- collection-item entry pick ---

const itemCollection = computed(() =>
  isCollectionItem.value && selectedElement.value?.arg
    ? collectionByName(selectedElement.value.arg)
    : null,
)

const entryOptions = computed(() => [
  { label: 'None', value: '' },
  ...(itemCollection.value?.entries.map((e) => ({ label: e.name, value: e.id })) ?? []),
])

// --- content (folded in from the former Content panel) ---

/** text-bearing elements expose their content for editing */
const hasContent = computed(() => def.value?.defaultContent !== undefined)
const isMedia = computed(() => ['image', 'video'].includes(selectedElement.value?.type ?? ''))

// collection field schema, edited on the template's body
const FIELD_TYPES = [
  { label: 'Text', value: 'text' },
  { label: 'Image', value: 'image' },
  { label: 'Date', value: 'date' },
  { label: 'Reference', value: 'reference' },
  { label: 'Multi-ref', value: 'multi-reference' },
]

const isRefType = (t: string) => t === 'reference' || t === 'multi-reference'

const collectionOptions = computed(() => collections.value.map((c) => ({ label: c.name, value: c.id })))

// switching a field to a reference type needs a target; default to the
// first collection so the picker is never dangling
function onFieldTypeChange(field: CollectionField, type: CollectionField['type']) {
  field.type = type
  if (isRefType(type)) field.refCollectionId ??= collections.value[0]?.id
  else delete field.refCollectionId
}

// --- binding resolution (possibly through a reference hop) ---

interface ResolvedBinding {
  collection: { id: string }
  field: CollectionField
  entry: CollectionEntry | null
}

const binding = computed<ResolvedBinding | null>(() =>
  resolveBinding(collections.value, activeCollection.value, activeEntry.value, selectedElement.value?.arg),
)
const boundField = computed(() => binding.value?.field ?? null)
const boundIsRef = computed(() => !!boundField.value && isRefType(boundField.value.type))

// the collection this element's arg-head points at, when the head field is a
// reference — drives the per-entry value pickers below (distinct from the
// Binding tab's refTarget, which only hops single references)
const pickRefTarget = computed(() =>
  headField.value?.refCollectionId ? collectionById(headField.value.refCollectionId) : null,
)

// single reference: which entry this entry points to (base values only —
// references are never locale-overridden)
const refValue = computed({
  get: () => {
    const v = activeEntry.value?.values[headField.value?.name ?? '']
    return typeof v === 'string' ? v : ''
  },
  set: (id: string) => {
    const entry = activeEntry.value
    const field = headField.value
    if (!entry || !field) return
    if (id) entry.values[field.name] = id
    else delete entry.values[field.name]
  },
})
const refOptions = computed(() => [
  { label: 'None', value: '' },
  ...(pickRefTarget.value?.entries.map((e) => ({ label: e.name, value: e.id })) ?? []),
])

// multi-reference: toggled id list, order = toggle order
const multiIds = computed(() =>
  headField.value && activeEntry.value ? refIds(activeEntry.value, headField.value.name) : [],
)
function toggleRef(id: string) {
  const entry = activeEntry.value
  const field = headField.value
  if (!entry || !field) return
  const ids = refIds(entry, field.name)
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
  if (next.length) entry.values[field.name] = next
  else delete entry.values[field.name]
}

/** the ref pickers need an entry loaded in the template canvas */
const showRefPicker = computed(
  () => !!headField.value && isRefType(headField.value.type) && !!activeEntry.value,
)

// bound elements with an entry loaded edit the ENTRY's value (following a
// reference hop when the binding is dotted) — that's how post content gets
// written. Under a non-default locale both paths edit that locale's
// override (empty clears it). Reference-typed binds are picked, not typed.
const content = computed({
  get: () => {
    if (boundField.value && !boundIsRef.value && binding.value?.entry) {
      return editEntryValue(binding.value.entry, boundField.value.name)
    }
    return selectedElement.value ? editNodeContent(selectedElement.value) : ''
  },
  set: (value: string) => {
    if (boundField.value && !boundIsRef.value && binding.value?.entry) {
      setEntryValue(binding.value.entry, boundField.value.name, value)
    } else if (selectedElement.value) {
      setNodeContent(selectedElement.value, value)
    }
  },
})

// translating: surface the default-locale value as the placeholder so
// the fallback stays visible while the override field is empty
const contentPlaceholder = computed(() => {
  if (!isDefault.value) {
    const entry = binding.value?.entry
    const base =
      boundField.value && !boundIsRef.value && entry
        ? entry.values[boundField.value.name]
        : selectedElement.value?.content
    if (typeof base === 'string' && base) return base
  }
  return def.value?.defaultContent
})

const src = computed({
  get: () => {
    if (boundField.value?.type === 'image' && binding.value?.entry) {
      return editEntryValue(binding.value.entry, boundField.value.name)
    }
    return selectedElement.value ? editNodeSrc(selectedElement.value) : ''
  },
  set: (value: string) => {
    if (boundField.value?.type === 'image' && binding.value?.entry) {
      setEntryValue(binding.value.entry, boundField.value.name, value)
    } else if (selectedElement.value) {
      setNodeSrc(selectedElement.value, value)
    }
  },
})
</script>

<template>
  <template v-if="selectedElement">
    <GroupPopover v-if="isBody && activeCollection" label="Fields">
      <div v-for="field in activeCollection.fields" :key="field.id" class="flex flex-col gap-1">
        <RowUI :label="field.name">
          <InputUI v-model="field.name" class="font-mono" />
          <SelectUI
            :model-value="field.type"
            :options="FIELD_TYPES"
            class="w-24"
            @update:model-value="(v) => v && onFieldTypeChange(field, v as never)"
          />
          <template #end>
            <ButtonUI
              variant="icon"
              size="sm"
              :icon="X"
              tooltip="Remove field"
              class="w-6 shrink-0 text-muted-foreground"
              @click="removeField(activeCollection!, field.id)"
            />
          </template>
        </RowUI>
        <RowUI v-if="isRefType(field.type)" label="To">
          <SelectUI v-model="field.refCollectionId" :options="collectionOptions" />
        </RowUI>
      </div>
      <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addField(activeCollection!)">
        Add field
      </ButtonUI>
    </GroupPopover>

    <!-- reference values are picked per entry, in entry context -->
    <GroupPopover v-if="showRefPicker" :label="headField!.name">
      <SelectUI v-if="headField!.type === 'reference'" v-model="refValue" :options="refOptions" />
      <template v-else>
        <label
          v-for="entry in pickRefTarget?.entries ?? []"
          :key="entry.id"
          class="flex cursor-pointer items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            :checked="multiIds.includes(entry.id)"
            class="accent-current"
            @change="toggleRef(entry.id)"
          />
          {{ entry.name }}
        </label>
        <p v-if="!pickRefTarget?.entries.length" class="text-[10px] text-muted-foreground">
          No entries in the referenced collection yet.
        </p>
      </template>
    </GroupPopover>

    <GroupPopover v-if="hasContent && !boundIsRef">
      <RichTextInput ref="contentField" v-model="content" :placeholder="contentPlaceholder" />
    </GroupPopover>

    <GroupPopover v-if="isMedia">
      <MediaPickerControl v-model="src" :kind="selectedElement.type === 'video' ? 'video' : 'image'" />
    </GroupPopover>

    <GroupPopover>
      <RowUI v-if="canEditTag" label="Tag">
        <SelectUI
          :model-value="selectedElement.type"
          :options="tagOptions"
          @update:model-value="(v) => changeElementType(selectedElement!.id, v!)"
        />
      </RowUI>
      <RowUI label="ID">
        <InputUI ref="idField" v-model="htmlId" placeholder="e.g. hero" class="font-mono" />
      </RowUI>
      <RowUI v-if="canLinkEntry" label="Link to entry">
        <ToggleUI v-model="linkToEntry" />
      </RowUI>
      <RowUI v-if="canLink && !linkToEntry" label="Link">
        <InputUI v-model="link" placeholder="/about or https://…" class="font-mono" />
      </RowUI>
    </GroupPopover>

    <GroupPopover v-if="canBind" label="Binding">
      <RowUI label="Field">
        <SelectUI :options="bindOptions" :model-value="bindHead" @update:model-value="(v) => setHead(v ?? null)" />
      </RowUI>
      <RowUI v-if="refTarget" label="Show">
        <SelectUI :options="tailOptions" :model-value="bindTail" @update:model-value="(v) => setTail(v ?? null)" />
      </RowUI>
      <p v-if="headField?.type === 'multi-reference'" class="text-[10px] text-muted-foreground">
        Shows the referenced entry names. Use a collection list to repeat per entry.
      </p>
    </GroupPopover>

    <GroupPopover v-if="isCollectionList" label="Source">
      <SelectUI :options="listOptions" v-model="listSource" />
      <p class="text-[10px] text-muted-foreground">
        A collection repeats all entries; a multi-reference field repeats the entries it points to.
      </p>
    </GroupPopover>

    <ConditionRows v-if="!isBody" />

    <GroupPopover v-if="isCollectionItem" label="Entry">
      <SelectUI
        v-if="itemCollection"
        :options="entryOptions"
        :model-value="selectedElement.entryId ?? ''"
        @update:model-value="(v) => (selectedElement!.entryId = v || undefined)"
      />
      <p v-else class="text-xs text-muted-foreground">
        Unknown collection — check the (name) in the code.
      </p>
    </GroupPopover>
  </template>
</template>
