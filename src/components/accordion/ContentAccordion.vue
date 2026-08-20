<script setup lang="ts">
import { inject } from 'vue'
import { accordionKey } from './context'

const accordion = inject(accordionKey)!
</script>

<template>
  <div v-if="accordion.open.value" class="flex flex-col gap-2 pl-6.5 pr-1.5 pb-2">
    <slot />
  </div>
</template>
