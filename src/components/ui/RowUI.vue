<script setup lang="ts">
defineProps<{
  label: string
}>()
</script>

<template>
  <!--
    When a #start slot is provided (e.g. the revert button) we always reserve
    its gutter with pl-8 and position it absolutely, so the row doesn't shift
    when the button toggles between rendered/hidden as a field gains a value.
  -->
  <div class="relative flex items-center gap-2 min-h-9 px-2.5" :class="$slots.start && 'pl-8'">
    <div v-if="$slots.start" class="absolute left-1 top-1/2 -translate-y-1/2">
      <slot name="start" />
    </div>
    <span class="w-18 shrink-0 truncate text-xs text-foreground">{{ label }}</span>
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <slot />
    </div>
    <slot name="end" />
  </div>
</template>
