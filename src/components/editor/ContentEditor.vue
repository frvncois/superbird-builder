<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { usePanel } from '@/composables/usePanel'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import UploadUI from '@/components/ui/UploadUI.vue'
import { Plus, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { ELEMENTS, typeOptionsFor } from '@/lib/elements'
import { useElement } from '@/composables/useElement'
import { useCollections } from '@/composables/useCollections'
import { useLocale } from '@/composables/useLocale'

const { selectedElement, changeElementType, setElementArg } = useElement()
const { activeCollection, activeEntry, collectionByName, fieldFor, addField, removeField } =
  useCollections()
const {
  isDefault,
  editNodeContent,
  setNodeContent,
  editNodeSrc,
  setNodeSrc,
  editEntryValue,
  setEntryValue,
} = useLocale()

// --- collections ---

const isBody = computed(() => selectedElement.value?.type === 'body')
const isCollectionItem = computed(() => selectedElement.value?.type === 'collection-item')

/** field the selected element is bound to on this template page */
const boundField = computed(() => fieldFor(activeCollection.value, selectedElement.value?.arg))

const FIELD_TYPES = [
  { label: 'Text', value: 'text' },
  { label: 'Image', value: 'image' },
  { label: 'Date', value: 'date' },
]

const bindOptions = computed(() => [
  { label: 'None', value: '' },
  ...(activeCollection.value?.fields.map((f) => ({ label: f.name, value: f.name })) ?? []),
])

const canBind = computed(
  () =>
    !!activeCollection.value &&
    !isBody.value &&
    !isCollectionItem.value &&
    selectedElement.value?.type !== 'collection-list' &&
    selectedElement.value?.line !== undefined,
)

const itemCollection = computed(() =>
  isCollectionItem.value && selectedElement.value?.arg
    ? collectionByName(selectedElement.value.arg)
    : null,
)

const entryOptions = computed(() => [
  { label: 'None', value: '' },
  ...(itemCollection.value?.entries.map((e) => ({ label: e.name, value: e.id })) ?? []),
])

const def = computed(() => (selectedElement.value ? ELEMENTS[selectedElement.value.type] : null))

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const tagOptions = computed(() =>
  typeOptionsFor(selectedElement.value?.type ?? '').map((t) => ({ label: capitalize(t), value: t })),
)

/** the tag can only be changed on a real page element with alternatives */
const canEditTag = computed(
  () => tagOptions.value.length > 0 && selectedElement.value?.line !== undefined,
)

/** text-bearing elements expose their content for editing */
const hasContent = computed(() => def.value?.defaultContent !== undefined)
const isMedia = computed(() => ['image', 'video'].includes(selectedElement.value?.type ?? ''))

// +C in the code editor focuses the natural first field
const { pendingFocus } = usePanel()
const contentField = ref<InstanceType<typeof TextareaUI>>()
const idField = ref<InstanceType<typeof InputUI>>()

function consumeFocus() {
  if (pendingFocus.value !== 'content') return
  pendingFocus.value = null
  nextTick(() => (hasContent.value ? contentField.value?.focus() : idField.value?.focus()))
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)

// links/buttons carry a navigation target for the published site
// (button ↔ link are a type-switch group, so the value survives switching)
const isLinkTag = computed(
  () => def.value?.tag === 'a' || selectedElement.value?.type === 'button',
)
const link = computed({
  get: () => selectedElement.value?.link ?? '',
  set: (value: string) => {
    if (selectedElement.value) selectedElement.value.link = value.trim() || undefined
  },
})

const htmlId = computed({
  get: () => selectedElement.value?.htmlId ?? '',
  set: (value: string) => {
    if (selectedElement.value) selectedElement.value.htmlId = value.trim() || undefined
  },
})

// bound elements with an entry loaded edit the ENTRY's value —
// that's how post content gets written. Under a non-default locale
// both paths edit that locale's override (empty clears it).
const content = computed({
  get: () => {
    if (boundField.value && activeEntry.value) {
      return editEntryValue(activeEntry.value, boundField.value.name)
    }
    return selectedElement.value ? editNodeContent(selectedElement.value) : ''
  },
  set: (value: string) => {
    if (boundField.value && activeEntry.value) {
      setEntryValue(activeEntry.value, boundField.value.name, value)
    } else if (selectedElement.value) {
      setNodeContent(selectedElement.value, value)
    }
  },
})

// translating: surface the default-locale value as the placeholder so
// the fallback stays visible while the override field is empty
const contentPlaceholder = computed(() => {
  if (!isDefault.value) {
    const base =
      boundField.value && activeEntry.value
        ? activeEntry.value.values[boundField.value.name]
        : selectedElement.value?.content
    if (base) return base
  }
  return def.value?.defaultContent
})

const src = computed({
  get: () => {
    if (boundField.value?.type === 'image' && activeEntry.value) {
      return editEntryValue(activeEntry.value, boundField.value.name)
    }
    return selectedElement.value ? editNodeSrc(selectedElement.value) : ''
  },
  set: (value: string) => {
    if (boundField.value?.type === 'image' && activeEntry.value) {
      setEntryValue(activeEntry.value, boundField.value.name, value)
    } else if (selectedElement.value) {
      setNodeSrc(selectedElement.value, value)
    }
  },
})
</script>

<template>
  <template v-if="selectedElement">
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
      <RowUI v-if="isLinkTag" label="Link">
        <InputUI v-model="link" placeholder="/about or https://…" class="font-mono" />
      </RowUI>
      <RowUI v-if="canBind" label="Field">
        <SelectUI
          :options="bindOptions"
          :model-value="selectedElement.arg ?? ''"
          @update:model-value="(v) => setElementArg(selectedElement!.id, v || null)"
        />
      </RowUI>
    </GroupPopover>

    <GroupPopover v-if="isCollectionItem">
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

    <GroupPopover v-if="isBody && activeCollection">
      <RowUI v-for="field in activeCollection.fields" :key="field.id" :label="field.name">
        <InputUI v-model="field.name" class="font-mono" />
        <SelectUI v-model="field.type" :options="FIELD_TYPES" class="w-20" />
        <template #end>
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="X"
            title="Remove field"
            class="w-6 shrink-0 text-muted-foreground"
            @click="removeField(activeCollection!, field.id)"
          />
        </template>
      </RowUI>
      <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addField(activeCollection!)">
        Add field
      </ButtonUI>
    </GroupPopover>

    <GroupPopover v-if="hasContent">
      <TextareaUI ref="contentField" v-model="content" :placeholder="contentPlaceholder" />
    </GroupPopover>

    <GroupPopover v-if="isMedia">
      <UploadUI v-model="src" :accept="selectedElement.type === 'video' ? 'video/*' : 'image/*'" />
    </GroupPopover>
  </template>
</template>
