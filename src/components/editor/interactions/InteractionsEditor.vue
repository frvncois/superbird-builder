<script setup lang="ts">
// The Interactions panel: what the selected element DOES, as one flat list of
// behaviours — tween animations and class-toggle interactions side by side,
// each a BindingRow reading "when · what · on which element", the kind a tag.
//
// Everything else lives one level down: the libraries and presets in the Add
// chooser (EffectChooser), and what an effect itself does — shared by every
// element using it — in the focused detail views (InteractionDetail /
// AnimationDetail). Editing those inline among per-element rows made a change
// that retimed the whole site look like a change to this one element.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import BindingRow from '@/components/editor/interactions/BindingRow.vue'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useInteraction } from '@/composables/useInteraction'
import { useShortcut } from '@/composables/useShortcut'
import { useEffectDetail } from '@/composables/useEffectDetail'
import type { AnimationBinding, InteractionBinding } from '@/types/editor'

const { highlightElement, isMultiSelect } = useElement()
const { pickingFor } = useInteraction()
const { editTarget } = useComponents()
const { openChooser, openBindingId: openId } = useEffectDetail()

// inside a component instance, effects land on the shared master
const target = editTarget

// Esc cancels a pending target pick
useShortcut('Escape', { onDown: () => (pickingFor.value = null) })

const canEdit = computed(() => !!target.value && !isMultiSelect.value)

type Row =
  | { kind: 'animation'; binding: AnimationBinding }
  | { kind: 'interaction'; binding: InteractionBinding }

/** timelines first (the richer system), then class toggles — each in the
 *  order they were added */
const rows = computed<Row[]>(() => {
  const n = canEdit.value ? target.value : null
  if (!n) return []
  return [
    ...(n.animations ?? []).map((binding) => ({ kind: 'animation', binding }) as Row),
    ...(n.interactions ?? []).map((binding) => ({ kind: 'interaction', binding }) as Row),
  ]
})

// one row open at a time. A row the chooser just added arrives open (it sets
// openBindingId) so the trigger and target are right there to adjust; a row
// that disappears, or a change of element, folds the list.
watch(
  () => rows.value.map((r) => r.binding.id),
  (ids) => {
    if (openId.value && !ids.includes(openId.value)) openId.value = null
  },
  { immediate: true },
)
watch(() => target.value?.id, () => (openId.value = null))

function toggleRow(id: string) {
  openId.value = openId.value === id ? null : id
}

// `I` in the Layers tree: the panel's primary action, so Enter adds
const { pendingFocus } = usePanel()
const addButton = ref<InstanceType<typeof ButtonUI>>()
function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => addButton.value?.$el?.focus?.())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)
// don't leave a dangling preview outline when the panel closes
onBeforeUnmount(() => highlightElement(null))
</script>

<template>
  <GroupPopover v-if="!canEdit">
    <p class="text-xs text-muted-foreground">
      {{
        isMultiSelect
          ? 'Select a single element to give it interactions.'
          : 'Select an element to give it interactions.'
      }}
    </p>
    <ButtonUI ref="addButton" variant="outline" size="sm" class="w-full" @click="openChooser()">
      Browse the library
    </ButtonUI>
  </GroupPopover>

  <div v-else class="flex flex-col gap-1.5 border-b border-input p-3 last:border-b-0">
    <div class="flex items-center justify-between">
      <p class="text-xs font-medium text-muted-foreground">
        On this element
        <span v-if="rows.length" class="text-muted-foreground/60">· {{ rows.length }}</span>
      </p>
      <ButtonUI ref="addButton" variant="outline" size="xs" :icon="Plus" @click="openChooser()">
        Add
      </ButtonUI>
    </div>

    <p v-if="!rows.length" class="py-1 text-xs text-muted-foreground">
      Nothing yet. Add an effect and say when it fires.
    </p>

    <BindingRow
      v-for="row in rows"
      :key="row.binding.id"
      v-bind="row"
      :owner="target!"
      :open="openId === row.binding.id"
      @toggle="toggleRow(row.binding.id)"
    />
  </div>
</template>
