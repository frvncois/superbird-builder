<script setup lang="ts">
defineProps<{
  headings: { id: string; text: string }[]
  active?: string | null
}>()

defineEmits<{ jump: [id: string] }>()
</script>

<template>
  <aside class="sticky top-0 hidden w-44 shrink-0 flex-col gap-1 self-start lg:flex">
    <p class="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
      On this page
    </p>
    <button
      v-for="heading in headings"
      :key="heading.id"
      class="cursor-pointer truncate rounded-md px-2 py-1 text-left text-xs transition-colors"
      :class="
        active === heading.id
          ? 'bg-secondary font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      "
      @click="$emit('jump', heading.id)"
    >
      {{ heading.text }}
    </button>
  </aside>
</template>
