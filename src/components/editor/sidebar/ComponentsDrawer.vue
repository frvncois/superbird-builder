<script setup lang="ts">
// Components navigator toggled from the left rail — a docked column sharing
// the one track beside the rail with Pages and the code editor. Two sections:
// the project's own components, and the bundled library of premades that are
// COPIED into the project when added.
import { ref } from 'vue'
import { useDrawerEscape } from '@/composables/useDrawerEscape'

const panel = ref<HTMLElement>()

useDrawerEscape(panel, { canPeel: () => false, peel: () => {} })
</script>

<template>
  <div ref="panel" class="flex h-full flex-col bg-background">
    <p class="px-2.5 py-2 text-[10px] text-muted-foreground">Components</p>
  </div>
</template>
