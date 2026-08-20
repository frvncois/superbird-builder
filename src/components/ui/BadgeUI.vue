<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{
  removable?: boolean
}>()

defineEmits<{
  remove: []
}>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground"
  >
    <slot />
    <button
      v-if="removable"
      class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
      @click="$emit('remove')"
    >
      <X class="size-2.5" />
    </button>
  </span>
</template>
