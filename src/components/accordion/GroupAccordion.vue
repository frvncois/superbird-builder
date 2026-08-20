<script setup lang="ts">
import { provide } from 'vue'
import { accordionKey } from './context'

// standalone it's local state (open by default); parents can bind
// v-model:open to drive it from data
const open = defineModel<boolean>('open', { default: true })

provide(accordionKey, {
  open,
  toggle: () => (open.value = !open.value),
})
</script>

<template>
  <div class="border-b border-input last:border-b-0">
    <slot />
  </div>
</template>
