<script setup lang="ts">
// What a STYLE CHANGE effect does: the classes an element wears while it is on,
// and how long the change takes.
//
// Takes an ID and re-resolves, never an object: undo and a branch switch swap
// the whole project graph, so a held object would detach silently.
import { computed } from 'vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import ClassFieldInput from '@/components/editor/style/ClassFieldInput.vue'
import { useInteraction } from '@/composables/useInteraction'
import type { Interaction } from '@/types/editor'

const props = defineProps<{ id: string }>()

const { animationFor, usageCount } = useInteraction()

const effect = computed(() => animationFor(props.id))

const DURATION_STOPS = ['75', '100', '150', '200', '300', '500', '700', '1000']

function durationIndex(item: Interaction): number {
  const i = DURATION_STOPS.indexOf(item.duration.replace('duration-', ''))
  return i === -1 ? DURATION_STOPS.indexOf('300') : i
}
function setDuration(item: Interaction, index: number) {
  item.duration = `duration-${DURATION_STOPS[index] ?? '300'}`
}

const EASING_PRESETS = [
  { label: 'Linear', value: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in' },
  { label: 'Ease out', value: 'ease-out' },
  { label: 'Ease in-out', value: 'ease-in-out' },
]

/**
 * An effect may carry a curve this list has no name for — the bundled library's
 * entries use `ease-[cubic-bezier(0.2,0,0,1)]`. Offering it as an option is what
 * keeps it: a select showing nothing reads as unset, and the next pick would
 * silently replace a curve the author never chose to lose. Same rule as the
 * class writer, which keeps a class the Style panel has no control for.
 */
const easingOptions = computed(() => {
  const current = effect.value?.easing
  if (!current || EASING_PRESETS.some((e) => e.value === current)) return EASING_PRESETS
  return [{ label: `Custom · ${current.replace(/^ease-/, '')}`, value: current }, ...EASING_PRESETS]
})
</script>

<template>
  <div v-if="effect" class="flex max-w-2xl flex-col gap-1.5 py-2">
    <RowUI label="Classes">
      <!-- no flex/grid prerequisites: a to-state is a change, not a layout -->
      <ClassFieldInput v-model="effect.toClasses" :prerequisites="false" class="font-mono" />
    </RowUI>

    <RowUI label="Easing">
      <SelectUI
        :model-value="effect.easing"
        :options="easingOptions"
        @update:model-value="(v) => v && (effect!.easing = v)"
      />
    </RowUI>

    <RowUI label="Duration">
      <SliderUI
        :min="0"
        :max="DURATION_STOPS.length - 1"
        :model-value="durationIndex(effect)"
        @update:model-value="(v) => setDuration(effect!, v)"
      />
      <span class="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {{ effect.duration.replace('duration-', '') }}ms
      </span>
    </RowUI>

    <p class="px-2.5 text-[10px] text-muted-foreground">
      The classes applied while this effect is on. A base class styling the same
      property is dropped while it runs, so <span class="font-mono">hidden</span> →
      <span class="font-mono">flex</span> works. Shared — used on
      {{ usageCount(id) }} element{{ usageCount(id) === 1 ? '' : 's' }}.
    </p>
  </div>
</template>
