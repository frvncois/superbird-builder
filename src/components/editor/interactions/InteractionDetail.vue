<script setup lang="ts">
// The focused editor for ONE saved interaction — what it does, shared by every
// element using it. Renders alone in the panel (see useEffectDetail): the
// per-element half is trigger, target and dismissal, and lives on the card.
//
// Takes an ID and re-resolves, never an object: undo and a branch switch swap
// the whole project graph, so a held object would detach silently.
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ClassFieldInput from '@/components/editor/style/ClassFieldInput.vue'
import { useInteraction } from '@/composables/useInteraction'
import { useEffectDetail } from '@/composables/useEffectDetail'
import { useModal } from '@/composables/useModal'
import type { Interaction } from '@/types/editor'

const props = defineProps<{ id: string; created: boolean }>()

const { animationFor, usageCount, deleteInteraction, pickingFor } = useInteraction()
const { closeDetail } = useEffectDetail()
const { confirm } = useModal()

const interaction = computed(() => animationFor(props.id))

const DURATION_STOPS = ['75', '100', '150', '200', '300', '500', '700', '1000']

function durationIndex(item: Interaction): number {
  const i = DURATION_STOPS.indexOf(item.duration.replace('duration-', ''))
  return i === -1 ? DURATION_STOPS.indexOf('300') : i
}
function setDuration(item: Interaction, index: number) {
  item.duration = `duration-${DURATION_STOPS[index] ?? '300'}`
}

const EASINGS = [
  { label: 'Linear', value: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in' },
  { label: 'Ease out', value: 'ease-out' },
  { label: 'Ease in-out', value: 'ease-in-out' },
]

const nameField = ref<InstanceType<typeof InputUI>>()
onMounted(() => {
  // a brand-new interaction is called "Interaction 3" — put the caret where
  // the first thing to do is
  if (props.created) nextTick(() => nameField.value?.focus())
})

/** Cancel discards outright: the cascading delete also strips the binding that
 * New auto-applied, wherever it landed — so it works even if the element has
 * since been deselected or deleted. */
function cancel() {
  deleteInteraction(props.id)
  closeDetail()
}

async function onDelete() {
  const used = usageCount(props.id)
  const ok = await confirm({
    title: 'Delete interaction',
    message: used
      ? `Delete “${interaction.value?.name}”? It is used on ${used} element${used === 1 ? '' : 's'}.`
      : `Delete “${interaction.value?.name}”?`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  deleteInteraction(props.id)
  closeDetail()
}

// Escape peels back one layer instead of closing the whole panel, which is
// what SettingsEditor's bubble-phase handler would do. Capture phase +
// stopPropagation beats it to the event (same trick as PagesDrawer).
// It KEEPS the interaction — only the Cancel button discards.
function onKeydownCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (pickingFor.value) return // a pick in flight cancels first
  e.stopPropagation()
  closeDetail()
}
onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydownCapture, true))
</script>

<template>
  <div v-if="interaction" class="flex flex-col">
    <!-- the popover header already says New/Edit interaction, so this row
         exists for the Back button and names the effect being edited. A brand
         new one has no name worth showing and nowhere to go back to. -->
    <div v-if="!created" class="flex items-center gap-1 border-b border-input px-1 py-1.5">
      <ButtonUI
        variant="icon"
        size="sm"
        :icon="ArrowLeft"
        tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="closeDetail()"
      />
      <span class="min-w-0 flex-1 truncate px-1 text-xs font-medium">{{ interaction.name }}</span>
    </div>

    <div class="flex flex-col gap-1.5 p-3">
      <RowUI label="Name">
        <InputUI ref="nameField" v-model="interaction.name" placeholder="Interaction" />
      </RowUI>

      <RowUI label="To">
        <ClassFieldInput
          v-model="interaction.toClasses"
          :prerequisites="false"
          class="font-mono"
        />
      </RowUI>

      <RowUI label="Easing">
        <SelectUI
          :model-value="interaction.easing"
          :options="EASINGS"
          @update:model-value="(v) => v && (interaction!.easing = v)"
        />
      </RowUI>

      <RowUI label="Duration">
        <SliderUI
          :min="0"
          :max="DURATION_STOPS.length - 1"
          :model-value="durationIndex(interaction)"
          @update:model-value="(v) => setDuration(interaction!, v)"
        />
        <span class="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
          {{ interaction.duration.replace('duration-', '') }}ms
        </span>
      </RowUI>

      <p class="px-1 text-[10px] text-muted-foreground">
        The classes applied while this interaction is on. Shared — used on
        {{ usageCount(id) }} element{{ usageCount(id) === 1 ? '' : 's' }}.
      </p>
    </div>

    <div class="flex items-center gap-1.5 border-t border-input p-3">
      <template v-if="created">
        <ButtonUI variant="ghost" size="sm" class="text-muted-foreground" @click="cancel">
          Cancel
        </ButtonUI>
        <ButtonUI variant="default" size="sm" class="flex-1" @click="closeDetail()">Done</ButtonUI>
      </template>
      <ButtonUI v-else variant="ghost" size="sm" class="text-danger" @click="onDelete">
        Delete interaction
      </ButtonUI>
    </div>
  </div>
</template>
