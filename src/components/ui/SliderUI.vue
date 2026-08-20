<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    step?: number
  }>(),
  { min: 0, max: 100, step: 1 },
)

const model = defineModel<number>({ default: 0 })

/** filled portion of the track, 0–100% */
const percent = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return ((model.value - props.min) / span) * 100
})
</script>

<template>
  <input
    :value="model"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    class="slider"
    :style="{
      background: `linear-gradient(to right, var(--foreground) ${percent}%, var(--muted) ${percent}%)`,
    }"
    @input="model = Number(($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 9999px;
  cursor: pointer;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  background: var(--foreground);
  border: none;
  transition: transform 0.1s ease;
}

.slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  background: var(--foreground);
  border: none;
}

.slider:hover::-webkit-slider-thumb {
  transform: scale(1.2);
}
.slider:hover::-moz-range-thumb {
  transform: scale(1.2);
}
</style>
