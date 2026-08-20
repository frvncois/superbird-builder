<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

defineProps<{
  options: { label: string; value: string }[]
  /** shown (disabled) when the model is empty/unset */
  placeholder?: string
}>()

const model = defineModel<string>()
</script>

<template>
  <div class="relative w-full">
    <select
      v-model="model"
      class="h-7 w-full cursor-pointer appearance-none rounded-lg bg-input pr-6 pl-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <option v-if="placeholder" value="" disabled hidden>{{ placeholder }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <ChevronDown
      class="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground"
    />
  </div>
</template>
