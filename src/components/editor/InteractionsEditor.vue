<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { usePanel } from '@/composables/usePanel'
import { Crosshair, Plus, X } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import { useElement } from '@/composables/useElement'
import { useInteraction } from '@/composables/useInteraction'
import { useShortcut } from '@/composables/useShortcut'
import { useComponents } from '@/composables/useComponents'
import type { Interaction } from '@/types/editor'

const { selectedElement, getElement } = useElement()
const { pickingFor, unfire } = useInteraction()
const { masterFor, findMasterNode } = useComponents()

// inside a component instance, interaction edits land on the shared master
const target = computed(() =>
  selectedElement.value
    ? (masterFor(selectedElement.value.id)?.master ?? selectedElement.value)
    : null,
)

// Esc cancels a pending target pick
useShortcut('Escape', { onDown: () => (pickingFor.value = null) })

const TRIGGERS = [
  { label: 'Hover', value: 'hover' },
  { label: 'Click', value: 'click' },
  { label: 'Appear', value: 'appear' },
]

const DURATIONS = [
  { label: '150 ms', value: 'duration-150' },
  { label: '300 ms', value: 'duration-300' },
  { label: '500 ms', value: 'duration-500' },
  { label: '700 ms', value: 'duration-700' },
]

const EASINGS = [
  { label: 'Linear', value: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in' },
  { label: 'Ease out', value: 'ease-out' },
  { label: 'Ease in-out', value: 'ease-in-out' },
]

const interactions = computed(() => target.value?.interactions ?? [])

// +I in the code editor focuses the first interaction's To field
const { pendingFocus } = usePanel()
const toFields = ref<InstanceType<typeof InputUI>[]>([])

function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  nextTick(() => toFields.value[0]?.focus())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)

function add() {
  const node = target.value
  if (!node) return
  node.interactions ??= []
  node.interactions.push({
    id: crypto.randomUUID(),
    trigger: 'hover',
    targetId: null,
    toClasses: '',
    duration: 'duration-300',
    easing: 'ease-out',
  })
}

function remove(interaction: Interaction) {
  const node = target.value
  if (!node?.interactions) return
  unfire(interaction.id)
  if (pickingFor.value === interaction.id) pickingFor.value = null
  node.interactions = node.interactions.filter((i) => i.id !== interaction.id)
}

function targetLabel(interaction: Interaction): string {
  if (!interaction.targetId || interaction.targetId === target.value?.id) {
    return 'This element'
  }
  const node = getElement(interaction.targetId) ?? findMasterNode(interaction.targetId)
  return node ? `:${node.type}` : 'Missing element'
}

function togglePicking(interaction: Interaction) {
  pickingFor.value = pickingFor.value === interaction.id ? null : interaction.id
}
</script>

<template>
  <GroupPopover
    v-for="(interaction, index) in interactions"
    :key="interaction.id"
    :label="`Interaction ${index + 1}`"
  >
    <RowUI label="Trigger">
      <SelectUI v-model="interaction.trigger" :options="TRIGGERS" />
      <template #end>
        <ButtonUI
          variant="icon"
          size="sm"
          :icon="X"
          title="Remove interaction"
          class="w-6 shrink-0 text-muted-foreground"
          @click="remove(interaction)"
        />
      </template>
    </RowUI>

    <RowUI label="Target">
      <span class="min-w-0 flex-1 truncate text-xs">{{ targetLabel(interaction) }}</span>
      <ButtonUI
        variant="outline"
        size="sm"
        :icon="Crosshair"
        :class="pickingFor === interaction.id && 'bg-accent text-accent-foreground'"
        @click="togglePicking(interaction)"
      >
        {{ pickingFor === interaction.id ? 'Click element…' : 'Pick' }}
      </ButtonUI>
      <ButtonUI
        v-if="interaction.targetId"
        variant="icon"
        size="sm"
        :icon="X"
        title="Reset target to this element"
        class="w-6 shrink-0 text-muted-foreground"
        @click="interaction.targetId = null"
      />
    </RowUI>

    <RowUI label="To">
      <InputUI
        ref="toFields"
        v-model="interaction.toClasses"
        placeholder="e.g. translate-x-8 bg-red-500"
        class="font-mono"
      />
    </RowUI>

    <RowUI label="Timing">
      <SelectUI v-model="interaction.duration" :options="DURATIONS" />
      <SelectUI v-model="interaction.easing" :options="EASINGS" />
    </RowUI>
  </GroupPopover>

  <div class="p-3">
    <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="add">
      Add interaction
    </ButtonUI>
  </div>
</template>
