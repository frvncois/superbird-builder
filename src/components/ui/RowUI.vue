<script setup lang="ts">
defineProps<{
  label: string
}>()
</script>

<template>
  <div class="relative flex items-center gap-2" :class="$slots.start && 'pl-5'">
    <!-- absolute action in the left gutter (e.g. a remove button) -->
    <div v-if="$slots.start" class="absolute top-1/2 -left-2.5 -translate-y-1/2">
      <slot name="start" />
    </div>
    <span class="w-18 shrink-0 truncate text-xs text-foreground">{{ label }}</span>
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <slot />
    </div>
    <slot name="end" />
  </div>
</template>
