<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  options: { label: string; value: string; icon: Component }[]
}>()

const model = defineModel<string>()
</script>

<template>
  <div class="flex w-full overflow-hidden gap-1">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :title="opt.label"
      class="flex h-8 flex-1 items-center justify-center transition-colors [&_svg]:size-3.5 rounded-lg border border-accent/25"
      :class="
        model === opt.value
          ? 'bg-accent/50 text-background'
          : 'text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground'
      "
      @click="model = opt.value"
    >
      <component :is="opt.icon" />
    </button>
  </div>
</template>
