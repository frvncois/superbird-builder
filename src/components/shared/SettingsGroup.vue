<script setup lang="ts">
// Card-style section for the project settings modal: title + one-line
// description header, then the fields. `danger` marks destructive groups.
defineProps<{
  title: string
  description?: string
  danger?: boolean
}>()
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-xl border p-4"
    :class="danger ? 'border-danger/40' : 'border-input'"
  >
    <div class="flex flex-col gap-0.5">
      <h3 class="text-xs font-medium" :class="danger ? 'text-danger' : 'text-foreground'">
        {{ title }}
      </h3>
      <p v-if="description" class="text-[10px] text-muted-foreground">{{ description }}</p>
    </div>
    <slot />
  </section>
</template>
