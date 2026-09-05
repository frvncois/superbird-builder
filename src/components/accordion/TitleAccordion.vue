<script setup lang="ts">
import { inject } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { accordionKey } from './context'

const accordion = inject(accordionKey)!
</script>

<template>
  <div
    class="flex h-9 cursor-pointer items-center justify-between pr-1 pl-2 select-none"
    @click="accordion.toggle()"
  >
    <span class="flex items-center gap-2 text-xs font-medium">
      <ChevronRight
        class="size-3.5 text-muted-foreground transition-transform"
        :class="accordion.open.value && 'rotate-90'"
      />
      <slot />
    </span>
    <span @click.stop>
      <slot name="action" />
    </span>
  </div>
</template>
