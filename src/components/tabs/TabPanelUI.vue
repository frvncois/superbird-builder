<script setup lang="ts">
import { inject } from 'vue'
import { tabsKey } from './context'

const props = defineProps<{ id: string }>()

const tabs = inject(tabsKey)!
</script>

<template>
  <div v-if="tabs.active.value === props.id" class="flex flex-col">
    <slot />
  </div>
</template>
