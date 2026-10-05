<script setup lang="ts">
// What a STYLE CHANGE half does, on ONE line: the classes an element wears
// while the effect is on, how long the change takes, and its curve.
//
// Takes an ID and re-resolves, never an object: undo and a branch switch swap
// the whole project graph, so a held object would detach silently.
import { computed } from 'vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ClassFieldInput from '@/components/editor/style/ClassFieldInput.vue'
import { useInteraction } from '@/composables/useInteraction'

const props = defineProps<{ id: string }>()

const { animationFor } = useInteraction()

const effect = computed(() => animationFor(props.id))

const DURATION_OPTIONS = ['75', '100', '150', '200', '300', '500', '700', '1000'].map((ms) => ({
  label: `${ms}ms`,
  value: `duration-${ms}`,
}))

const EASING_PRESETS = [
  { label: 'Linear', value: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in' },
  { label: 'Ease out', value: 'ease-out' },
  { label: 'Ease in-out', value: 'ease-in-out' },
]

/**
 * An effect may carry a curve this list has no name for — older library
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

/** same rule for a duration outside the stops */
const durationOptions = computed(() => {
  const current = effect.value?.duration
  if (!current || DURATION_OPTIONS.some((d) => d.value === current)) return DURATION_OPTIONS
  return [{ label: current.replace(/^duration-/, '') + 'ms', value: current }, ...DURATION_OPTIONS]
})
</script>

<template>
  <div v-if="effect" class="flex items-center gap-2 px-2.5 py-2">
    <!-- no flex/grid prerequisites: a to-state is a change, not a layout -->
    <ClassFieldInput v-model="effect.toClasses" :prerequisites="false" class="min-w-0 flex-1 font-mono" />
    <div class="w-24 shrink-0">
      <SelectUI
        :model-value="effect.duration"
        :options="durationOptions"
        @update:model-value="(v) => v && (effect!.duration = v)"
      />
    </div>
    <div class="w-32 shrink-0">
      <SelectUI
        :model-value="effect.easing"
        :options="easingOptions"
        @update:model-value="(v) => v && (effect!.easing = v)"
      />
    </div>
  </div>
</template>
