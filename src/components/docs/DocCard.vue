<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
  lead: string
}>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    class="group flex cursor-pointer flex-col gap-2.5 rounded-xl border border-input p-4 text-left transition-colors hover:bg-muted/40"
    @click="$emit('select')"
  >
    <span
      class="flex size-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground"
    >
      <component :is="icon" class="size-4" />
    </span>
    <span class="flex flex-col gap-0.5">
      <span class="text-sm font-medium text-foreground">{{ title }}</span>
      <span class="text-xs leading-5 text-muted-foreground">{{ lead }}</span>
    </span>
  </button>
</template>
